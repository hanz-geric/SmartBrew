import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import AdminLayout from './AdminLayout';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { listStockItems, upsertStockItem, deleteStockItem } from '../../firebase/firestoreService';
import { StockItem } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

type Props = NativeStackScreenProps<AdminStackParamList, 'StockEdit'>;

const COMMON_UNITS = ['g', 'kg', 'mL', 'L', 'pcs', 'bags', 'boxes', 'shots'];

export default function StockEditScreen({ route, navigation }: Props) {
  const { itemId } = route.params;
  const isEdit = !!itemId;

  const [loading,  setLoading]  = useState(isEdit);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  // Form fields
  const [name,        setName]        = useState('');
  const [unit,        setUnit]        = useState('');
  const [customUnit,  setCustomUnit]  = useState('');
  const [useCustom,   setUseCustom]   = useState(false);
  const [qtyOnHand,   setQtyOnHand]   = useState('0');
  const [reorderLevel, setReorderLevel] = useState('0');
  const [costPerUnit, setCostPerUnit] = useState('');
  const [isActive,    setIsActive]    = useState(true);

  // Batch cost calculator
  const [calcQty,   setCalcQty]   = useState('');
  const [calcUnit,  setCalcUnit]  = useState<'same' | 'kg' | 'g' | 'L' | 'mL'>('same');
  const [calcPrice, setCalcPrice] = useState('');

  useEffect(() => {
    if (!itemId) return;
    listStockItems().then((all) => {
      const item = all.find((i) => i.id === itemId);
      if (!item) { navigation.goBack(); return; }
      setName(item.name);
      const isCommon = COMMON_UNITS.includes(item.unit);
      if (isCommon) {
        setUnit(item.unit);
        setUseCustom(false);
      } else {
        setCustomUnit(item.unit);
        setUseCustom(true);
      }
      setQtyOnHand(item.quantity_on_hand.toString());
      setReorderLevel(item.reorder_level.toString());
      setCostPerUnit(item.cost_per_unit > 0 ? item.cost_per_unit.toString() : '');
      setIsActive(item.is_active);
    }).finally(() => setLoading(false));
  }, [itemId]);

  function resolvedUnit() {
    return useCustom ? customUnit.trim() : unit;
  }

  // Returns { costPerUnit, qtyInItemUnit } or null if inputs are invalid / units incompatible
  function computeBatchCost(): { costPerUnit: number; qtyInItemUnit: number } | null {
    const qty   = parseFloat(calcQty);
    const price = parseFloat(calcPrice);
    if (!qty || !price || qty <= 0 || price <= 0) return null;

    const itemUnit     = resolvedUnit();
    const purchaseUnit = calcUnit === 'same' ? itemUnit : calcUnit;

    if (purchaseUnit === itemUnit) {
      return { costPerUnit: price / qty, qtyInItemUnit: qty };
    }

    const toGrams: Record<string, number> = { g: 1, kg: 1000 };
    if (toGrams[purchaseUnit] !== undefined && toGrams[itemUnit] !== undefined) {
      const qtyInItemUnit = qty * toGrams[purchaseUnit] / toGrams[itemUnit];
      return { costPerUnit: price / qtyInItemUnit, qtyInItemUnit };
    }

    const toMl: Record<string, number> = { mL: 1, L: 1000 };
    if (toMl[purchaseUnit] !== undefined && toMl[itemUnit] !== undefined) {
      const qtyInItemUnit = qty * toMl[purchaseUnit] / toMl[itemUnit];
      return { costPerUnit: price / qtyInItemUnit, qtyInItemUnit };
    }

    return null; // incompatible units (e.g. buying kg when item is mL)
  }

  function handleCalcInput(field: 'qty' | 'unit' | 'price', value: string | 'same' | 'kg' | 'g' | 'L' | 'mL') {
    if (field === 'qty')   setCalcQty(value as string);
    if (field === 'unit')  setCalcUnit(value as typeof calcUnit);
    if (field === 'price') setCalcPrice(value as string);
    // Auto-fill cost after state settles — use current + new value
    const nextQty   = field === 'qty'   ? value as string   : calcQty;
    const nextUnit  = field === 'unit'  ? value as typeof calcUnit : calcUnit;
    const nextPrice = field === 'price' ? value as string   : calcPrice;
    const qty   = parseFloat(nextQty);
    const price = parseFloat(nextPrice);
    if (qty > 0 && price > 0) {
      const itemUnit     = resolvedUnit();
      const purchaseUnit = nextUnit === 'same' ? itemUnit : nextUnit;
      let qtyInItemUnit = qty;
      const toGrams: Record<string, number> = { g: 1, kg: 1000 };
      const toMl: Record<string, number>    = { mL: 1, L: 1000 };
      if (purchaseUnit !== itemUnit) {
        if (toGrams[purchaseUnit] !== undefined && toGrams[itemUnit] !== undefined) {
          qtyInItemUnit = qty * toGrams[purchaseUnit] / toGrams[itemUnit];
        } else if (toMl[purchaseUnit] !== undefined && toMl[itemUnit] !== undefined) {
          qtyInItemUnit = qty * toMl[purchaseUnit] / toMl[itemUnit];
        } else {
          return; // incompatible, don't auto-fill
        }
      }
      setCostPerUnit((price / qtyInItemUnit).toFixed(4));
    }
  }

  function validate(): string | null {
    if (!name.trim()) return 'Name is required.';
    if (!resolvedUnit()) return 'Unit is required.';
    if (isNaN(parseFloat(qtyOnHand))) return 'Quantity on hand must be a number.';
    if (isNaN(parseFloat(reorderLevel))) return 'Reorder level must be a number.';
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) { setError(err); return; }
    setSaving(true);
    setError('');
    try {
      const data: Omit<StockItem, 'id' | 'stock_status'> = {
        name:             name.trim(),
        unit:             resolvedUnit(),
        quantity_on_hand: parseFloat(qtyOnHand) || 0,
        reorder_level:    parseFloat(reorderLevel) || 0,
        cost_per_unit:    parseFloat(costPerUnit) || 0,
        is_active:        isActive,
      };
      await upsertStockItem(data, itemId);
      navigation.goBack();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Failed to save: ${msg}`);
      setSaving(false);
    }
  }

  function handleDelete() {
    Alert.alert(
      'Delete Stock Item',
      `Delete "${name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              await deleteStockItem(itemId!);
              navigation.goBack();
            } catch {
              setError('Failed to delete. Check your connection.');
              setSaving(false);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <AdminLayout active="Stock">
        <View style={s.loadingRoot}>
          <ActivityIndicator size="large" color={Colors.green600} />
        </View>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout active="Stock">
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'android' ? 'height' : 'padding'}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
            <Text style={s.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.headerTitle}>{isEdit ? 'Edit Stock Item' : 'New Stock Item'}</Text>
        </View>

        <View style={s.card}>
          {/* Name */}
          <View style={s.field}>
            <Text style={s.label}>Name <Text style={s.required}>*</Text></Text>
            <TextInput
              style={s.input}
              placeholder="e.g. Espresso Beans, Whole Milk"
              placeholderTextColor={Colors.gray400}
              value={name}
              onChangeText={(t) => { setName(t); setError(''); }}
              autoCapitalize="words"
            />
          </View>

          {/* Unit */}
          <View style={s.field}>
            <Text style={s.label}>Unit <Text style={s.required}>*</Text></Text>
            <View style={s.unitChips}>
              {COMMON_UNITS.map((u) => (
                <TouchableOpacity
                  key={u}
                  style={[s.chip, !useCustom && unit === u && s.chipSel]}
                  onPress={() => { setUnit(u); setUseCustom(false); setError(''); }}
                  activeOpacity={0.7}
                >
                  <Text style={[s.chipText, !useCustom && unit === u && s.chipTextSel]}>{u}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[s.chip, useCustom && s.chipSel]}
                onPress={() => { setUseCustom(true); setUnit(''); setError(''); }}
                activeOpacity={0.7}
              >
                <Text style={[s.chipText, useCustom && s.chipTextSel]}>Other</Text>
              </TouchableOpacity>
            </View>
            {useCustom && (
              <TextInput
                style={[s.input, { marginTop: Spacing.sm }]}
                placeholder="e.g. sachets, tubs, gallons"
                placeholderTextColor={Colors.gray400}
                value={customUnit}
                onChangeText={(t) => { setCustomUnit(t); setError(''); }}
                autoCapitalize="none"
                autoFocus
              />
            )}
          </View>

          {/* Qty + Reorder side by side */}
          <View style={s.row}>
            <View style={[s.field, s.flex1]}>
              <Text style={s.label}>Qty on Hand</Text>
              <View style={s.inputWithUnit}>
                <TextInput
                  style={[s.input, s.flex1]}
                  keyboardType="numeric"
                  value={qtyOnHand}
                  onChangeText={(t) => { setQtyOnHand(t); setError(''); }}
                />
                <Text style={s.unitSuffix}>{resolvedUnit() || 'unit'}</Text>
              </View>
            </View>
            <View style={[s.field, s.flex1]}>
              <Text style={s.label}>Alert Below</Text>
              <View style={s.inputWithUnit}>
                <TextInput
                  style={[s.input, s.flex1]}
                  keyboardType="numeric"
                  value={reorderLevel}
                  onChangeText={(t) => { setReorderLevel(t); setError(''); }}
                />
                <Text style={s.unitSuffix}>{resolvedUnit() || 'unit'}</Text>
              </View>
              <Text style={s.fieldHint}>0 to disable</Text>
            </View>
          </View>

          {/* Batch cost calculator */}
          <View style={s.field}>
            <Text style={s.label}>Batch Cost Calculator <Text style={s.optional}>optional</Text></Text>
            <Text style={s.fieldHint}>Fill in what you paid for a batch to auto-calculate cost per unit.</Text>
            <View style={calc.sentenceRow}>
              <Text style={calc.word}>Bought</Text>
              <TextInput
                style={calc.numInput}
                value={calcQty}
                onChangeText={(v) => handleCalcInput('qty', v)}
                keyboardType="decimal-pad"
                placeholder="qty"
                placeholderTextColor={Colors.gray400}
              />
              <View style={calc.unitPicker}>
                {(['same', 'kg', 'g', 'L', 'mL'] as const).map((u) => (
                  <TouchableOpacity
                    key={u}
                    style={[calc.unitChip, calcUnit === u && calc.unitChipSel]}
                    onPress={() => handleCalcInput('unit', u)}
                    activeOpacity={0.7}
                  >
                    <Text style={[calc.unitChipText, calcUnit === u && calc.unitChipTextSel]}>
                      {u === 'same' ? resolvedUnit() || 'unit' : u}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={calc.word}>for ₱</Text>
              <TextInput
                style={calc.numInput}
                value={calcPrice}
                onChangeText={(v) => handleCalcInput('price', v)}
                keyboardType="decimal-pad"
                placeholder="price"
                placeholderTextColor={Colors.gray400}
              />
            </View>
            {(() => {
              const result = computeBatchCost();
              if (!result) return null;
              const u = resolvedUnit() || 'unit';
              return (
                <View style={calc.result}>
                  <Text style={calc.resultText}>
                    → ₱{result.costPerUnit.toFixed(4)} per {u}
                    {'  '}({result.qtyInItemUnit.toFixed(2)} {u} total)
                  </Text>
                  <Text style={calc.resultHint}>Cost/unit field updated automatically.</Text>
                </View>
              );
            })()}
          </View>

          {/* Cost per unit */}
          <View style={s.field}>
            <Text style={s.label}>Cost per Unit (₱) <Text style={s.optional}>optional</Text></Text>
            <View style={s.inputWithUnit}>
              <Text style={s.prefix}>₱</Text>
              <TextInput
                style={[s.input, s.flex1]}
                keyboardType="numeric"
                placeholder="0.00"
                placeholderTextColor={Colors.gray400}
                value={costPerUnit}
                onChangeText={(t) => { setCostPerUnit(t); setError(''); }}
              />
              <Text style={s.unitSuffix}>/ {resolvedUnit() || 'unit'}</Text>
            </View>
          </View>

          {/* Active toggle (edit only) */}
          {isEdit && (
            <>
              <View style={s.divider} />
              <View style={s.switchRow}>
                <View>
                  <Text style={s.switchLabel}>Active</Text>
                  <Text style={s.switchHint}>Inactive items are hidden from product tracking</Text>
                </View>
                <Switch
                  value={isActive}
                  onValueChange={setIsActive}
                  trackColor={{ true: Colors.green600, false: Colors.gray300 }}
                  thumbColor={Colors.white}
                />
              </View>
            </>
          )}

          {!!error && (
            <View style={s.errorContainer}>
              <Text style={s.error}>{error}</Text>
            </View>
          )}
        </View>

        {/* Save */}
        <TouchableOpacity
          style={[s.saveBtn, saving && s.saveBtnOff]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color={Colors.white} />
            : <Text style={s.saveBtnText}>{isEdit ? 'Update Stock Item' : 'Add Stock Item'}</Text>
          }
        </TouchableOpacity>

        {isEdit && (
          <TouchableOpacity style={s.deleteBtn} onPress={handleDelete} disabled={saving}>
            <Text style={s.deleteBtnText}>Delete Item</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
    </AdminLayout>
  );
}

const s = StyleSheet.create({
  loadingRoot: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  root:        { flex: 1, backgroundColor: Colors.background },
  scroll: {
    padding: Spacing.xl, paddingBottom: Spacing.xxxl,
    maxWidth: 560, alignSelf: 'center', width: '100%', gap: Spacing.lg,
  },

  header:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  backText:   { fontSize: FontSize.base, color: Colors.green700, fontWeight: FontWeight.medium },
  headerTitle: { fontSize: FontSize.display, fontWeight: FontWeight.bold, color: Colors.gray900 },

  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.xl, gap: Spacing.lg, ...Shadow.md,
  },

  field:      { gap: Spacing.xs },
  label:      { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },
  required:   { color: Colors.danger },
  optional:   { fontWeight: FontWeight.normal, color: Colors.gray400, fontSize: FontSize.xs },
  fieldHint:  { fontSize: FontSize.xs, color: Colors.gray400, marginTop: 2 },

  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    fontSize: FontSize.base, color: Colors.gray900, backgroundColor: Colors.gray50,
  },
  inputWithUnit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  prefix:    { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray500 },
  unitSuffix: { fontSize: FontSize.sm, color: Colors.gray500, minWidth: 32 },

  unitChips:  { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, backgroundColor: Colors.gray100,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  chipSel:     { backgroundColor: Colors.green50, borderColor: Colors.green600 },
  chipText:    { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.gray600 },
  chipTextSel: { color: Colors.green700, fontWeight: FontWeight.bold },

  row:  { flexDirection: 'row', gap: Spacing.lg },
  flex1: { flex: 1 },

  divider:    { height: 1, backgroundColor: Colors.border },
  switchRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.lg },
  switchLabel: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray800 },
  switchHint:  { fontSize: FontSize.xs, color: Colors.gray400, marginTop: 2, maxWidth: 240 },

  errorContainer: {
    backgroundColor: Colors.dangerBg,
    borderWidth: 1,
    borderColor: Colors.danger + '44',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  error: { fontSize: FontSize.sm, color: Colors.danger, fontWeight: FontWeight.medium },

  saveBtn: {
    backgroundColor: Colors.green600, borderRadius: Radius.md,
    paddingVertical: Spacing.lg, alignItems: 'center', ...Shadow.md,
  },
  saveBtnOff:  { backgroundColor: Colors.gray300 },
  saveBtnText: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.white },

  deleteBtn: {
    borderRadius: Radius.md, paddingVertical: Spacing.md, alignItems: 'center',
  },
  deleteBtnText: { fontSize: FontSize.base, color: Colors.danger, fontWeight: FontWeight.medium },
});

const calc = StyleSheet.create({
  sentenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  word: {
    fontSize: FontSize.sm,
    color: Colors.gray600,
    fontWeight: FontWeight.medium,
  },
  numInput: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.gray900,
    backgroundColor: Colors.gray50,
    width: 80,
    textAlign: 'center',
  },
  unitPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  unitChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.gray100,
  },
  unitChipSel: {
    borderColor: Colors.green600,
    backgroundColor: Colors.green50,
  },
  unitChipText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.gray600,
  },
  unitChipTextSel: {
    color: Colors.green700,
    fontWeight: FontWeight.bold,
  },
  result: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.green50,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.green200,
    gap: 2,
  },
  resultText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.green700,
  },
  resultHint: {
    fontSize: FontSize.xs,
    color: Colors.green600,
  },
});
