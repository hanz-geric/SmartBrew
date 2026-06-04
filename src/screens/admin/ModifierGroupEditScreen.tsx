import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Switch, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { AppModal } from '../../components/ui';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AdminLayout from './AdminLayout';
import { AdminStackParamList } from '../../navigation/AdminStack';
import {
  getAllModifierGroups, upsertModifierGroup, deleteModifierGroup, listStockItems,
} from '../../firebase/firestoreService';
import { Modifier, RecipeLine, StockItem } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing, rs,
} from '../../constants/theme';

type Nav   = NativeStackNavigationProp<AdminStackParamList>;
type Route = RouteProp<AdminStackParamList, 'ModifierGroupEdit'>;

// Local modifier row (includes a stable React key separate from the Firestore id)
interface LocalModifier extends Modifier {
  _key: string;
}

function makeKey() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function makeNewModifier(): LocalModifier {
  const key = makeKey();
  return { _key: key, id: key, name: '', price_delta: 0, sort_order: 0, is_active: true };
}

export default function ModifierGroupEditScreen() {
  const navigation = useNavigation<Nav>();
  const route      = useRoute<Route>();
  const { groupId } = route.params;
  const isNew = !groupId;

  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [error,         setError]         = useState('');
  const [showDelConfirm, setShowDelConfirm] = useState(false);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);

  // Group fields
  const [name,       setName]       = useState('');
  const [isRequired, setIsRequired] = useState(false);
  const [maxSelect,  setMaxSelect]  = useState('1');
  const [sortOrder,  setSortOrder]  = useState('0');
  const [isActive,   setIsActive]   = useState(true);

  // Modifier rows
  const [modifiers, setModifiers] = useState<LocalModifier[]>([makeNewModifier()]);

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const [groups, items] = await Promise.all([
        getAllModifierGroups(),
        listStockItems(),
      ]);
      setStockItems(items.filter((i) => i.is_active));

      if (!isNew) {
        const g = groups.find((x) => x.id === groupId);
        if (g) {
          setName(g.name);
          setIsRequired(g.is_required);
          setMaxSelect(String(g.max_select));
          setSortOrder(String(g.sort_order ?? 0));
          setIsActive(g.is_active !== false);
          setModifiers(
            g.modifiers.length > 0
              ? g.modifiers.map((m) => ({ ...m, _key: m.id }))
              : [makeNewModifier()],
          );
        }
      }
    } catch {
      setError('Failed to load group.');
    } finally {
      setLoading(false);
    }
  }

  function updateModifier(key: string, patch: Partial<LocalModifier>) {
    setModifiers((prev) => prev.map((m) => m._key === key ? { ...m, ...patch } : m));
  }

  function removeModifier(key: string) {
    setModifiers((prev) => {
      const next = prev.filter((m) => m._key !== key);
      return next.length > 0 ? next : [makeNewModifier()];
    });
  }

  function addModifier() {
    setModifiers((prev) => [...prev, makeNewModifier()]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }

  async function handleSave() {
    setError('');
    const trimmedName = name.trim();
    if (!trimmedName) { setError('Group name is required.'); return; }

    const maxSel = parseInt(maxSelect, 10);
    if (isNaN(maxSel) || maxSel < 1) { setError('Max select must be at least 1.'); return; }

    // Validate modifiers — at least the non-empty ones must have a name
    const validMods = modifiers.filter((m) => m.name.trim() !== '');
    if (validMods.length === 0) { setError('Add at least one modifier option.'); return; }

    const cleanMods: Modifier[] = validMods.map((m, i) => ({
      id:           m.id,
      name:         m.name.trim(),
      price_delta:  parseFloat(String(m.price_delta)) || 0,
      sort_order:   m.sort_order ?? i,
      is_active:    m.is_active,
      recipe_lines: (m.recipe_lines ?? []).filter(
        (l) => l.stock_item_id && l.quantity_required > 0,
      ),
    }));

    setSaving(true);
    try {
      await upsertModifierGroup(
        {
          name:        trimmedName,
          is_required: isRequired,
          max_select:  maxSel,
          sort_order:  parseInt(sortOrder, 10) || 0,
          is_active:   isActive,
          modifiers:   cleanMods,
        },
        groupId,
      );
      navigation.goBack();
    } catch (e: unknown) {
      const msg = (e as { code?: string }).code === 'permission-denied'
        ? 'Permission denied.'
        : 'Failed to save. Check your connection.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    setShowDelConfirm(true);
  }

  async function doDelete() {
    setDeleting(true);
    try {
      await deleteModifierGroup(groupId!);
      navigation.goBack();
    } catch (e: unknown) {
      const msg = (e as { code?: string }).code === 'permission-denied'
        ? 'Permission denied.'
        : 'Failed to delete.';
      setError(msg);
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <AdminLayout active="Modifiers">
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.green600} />
        </View>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout active="Modifiers">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'android' ? 'height' : 'padding'}
      >
        <ScrollView
          ref={scrollRef}
          style={s.scroll}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={s.pageHeader}>
            <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
              <Text style={s.backText}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={s.pageTitle}>{isNew ? 'New Modifier Group' : 'Edit Modifier Group'}</Text>
          </View>

          {/* Group Settings */}
          <Section title="Group Settings">
            <Field label="Group Name" required>
              <TextInput
                style={s.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Size, Temperature, Sugar Level"
                placeholderTextColor={Colors.gray400}
              />
            </Field>

            <View style={s.row2}>
              <View style={{ flex: 1 }}>
                <Field label="Max Selections" hint="How many options a customer can pick">
                  <TextInput
                    style={s.input}
                    value={maxSelect}
                    onChangeText={setMaxSelect}
                    keyboardType="numeric"
                    placeholder="1"
                    placeholderTextColor={Colors.gray400}
                  />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Sort Order" hint="Lower = appears first">
                  <TextInput
                    style={s.input}
                    value={sortOrder}
                    onChangeText={setSortOrder}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={Colors.gray400}
                  />
                </Field>
              </View>
            </View>

            <SwitchRow
              label="Required"
              hint="Customer must choose from this group before adding to cart"
              value={isRequired}
              onChange={setIsRequired}
            />
            <SwitchRow
              label="Active"
              hint="Inactive groups are hidden from the POS"
              value={isActive}
              onChange={setIsActive}
            />
          </Section>

          {/* Modifier Options */}
          <Section title="Options">
            <Text style={s.sectionHint}>
              Each option appears as a selectable button when adding a product to the cart.
            </Text>

            {modifiers.map((m, index) => (
              <ModifierRow
                key={m._key}
                modifier={m}
                index={index}
                onChange={(patch) => updateModifier(m._key, patch)}
                onRemove={() => removeModifier(m._key)}
                showRemove={modifiers.length > 1 || m.name.trim() !== ''}
                stockItems={stockItems}
              />
            ))}

            <TouchableOpacity style={s.addModBtn} onPress={addModifier} activeOpacity={0.7}>
              <Text style={s.addModBtnText}>+ Add Option</Text>
            </TouchableOpacity>
          </Section>

          {/* Danger zone */}
          {!isNew && (
            <Section title="Danger Zone">
              <Text style={s.dangerHint}>
                Deleting this group removes it from all products that use it. This cannot be undone.
              </Text>
              <TouchableOpacity
                style={[s.deleteBtn, deleting && s.saveBtnOff]}
                onPress={confirmDelete}
                disabled={deleting || saving}
                activeOpacity={0.8}
              >
                {deleting
                  ? <ActivityIndicator color={Colors.danger} size="small" />
                  : <Text style={s.deleteBtnText}>Delete Group</Text>
                }
              </TouchableOpacity>
            </Section>
          )}
        </ScrollView>

        {/* Footer — save button pinned to bottom */}
        <View style={s.footer}>
          {!!error && (
            <View style={s.errorInline}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}
          <TouchableOpacity
            style={[s.saveBtn, (saving || deleting) && s.saveBtnOff]}
            onPress={handleSave}
            disabled={saving || deleting}
            activeOpacity={0.8}
          >
            {saving
              ? <ActivityIndicator color={Colors.white} size="small" />
              : <Text style={s.saveBtnText}>{isNew ? 'Create' : 'Save Changes'}</Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <AppModal
        visible={showDelConfirm}
        variant="confirm"
        danger
        title="Delete Group"
        body={`Delete "${name}"? This cannot be undone. Any products using this group will lose these modifier options.`}
        confirmText="Delete"
        onCancel={() => setShowDelConfirm(false)}
        onConfirm={() => { setShowDelConfirm(false); doDelete(); }}
      />
    </AdminLayout>
  );
}

// ─── ModifierRow ──────────────────────────────────────────────────────────────

function ModifierRow({
  modifier, index, onChange, onRemove, showRemove, stockItems,
}: {
  modifier:   LocalModifier;
  index:      number;
  onChange:   (patch: Partial<LocalModifier>) => void;
  onRemove:   () => void;
  showRemove: boolean;
  stockItems: StockItem[];
}) {
  const lines = modifier.recipe_lines ?? [];
  const [showRecipe, setShowRecipe] = useState(lines.length > 0);

  function updateLine(i: number, patch: Partial<RecipeLine>) {
    const next = lines.map((l, idx) => idx === i ? { ...l, ...patch } : l);
    onChange({ recipe_lines: next });
  }

  function addLine() {
    onChange({ recipe_lines: [...lines, { stock_item_id: '', quantity_required: 0 }] });
  }

  function removeLine(i: number) {
    onChange({ recipe_lines: lines.filter((_, idx) => idx !== i) });
  }

  return (
    <View style={mr.root}>
      {/* Row header */}
      <View style={mr.header}>
        <View style={mr.indexBadge}>
          <Text style={mr.indexText}>{index + 1}</Text>
        </View>

        <View style={mr.fields}>
          <TextInput
            style={mr.nameInput}
            value={modifier.name}
            onChangeText={(v) => onChange({ name: v })}
            placeholder="Option name (e.g. Extra Cream)"
            placeholderTextColor={Colors.gray400}
          />
          <View style={mr.row}>
            <View style={mr.priceWrap}>
              <Text style={mr.pricePrefix}>+₱</Text>
              <TextInput
                style={mr.priceInput}
                value={modifier.price_delta === 0 ? '' : String(modifier.price_delta)}
                onChangeText={(v) => onChange({ price_delta: parseFloat(v) || 0 })}
                placeholder="0"
                placeholderTextColor={Colors.gray400}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={mr.switchWrap}>
              <Text style={mr.switchLabel}>Active</Text>
              <Switch
                value={modifier.is_active}
                onValueChange={(v) => onChange({ is_active: v })}
                trackColor={{ true: Colors.green600, false: Colors.gray300 }}
                thumbColor={Colors.white}
                style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
              />
            </View>
          </View>
        </View>

        {showRemove && (
          <TouchableOpacity style={mr.removeBtn} onPress={onRemove} activeOpacity={0.7} hitSlop={8}>
            <Text style={mr.removeText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Recipe toggle */}
      <TouchableOpacity
        style={mr.recipeToggle}
        onPress={() => {
          if (showRecipe && lines.length > 0) {
            onChange({ recipe_lines: [] });
          }
          setShowRecipe((v) => !v);
        }}
        activeOpacity={0.7}
      >
        <Text style={mr.recipeToggleText}>
          {showRecipe
            ? `📦 ${lines.filter((l) => l.stock_item_id && l.quantity_required > 0).length} ingredient${lines.filter((l) => l.stock_item_id && l.quantity_required > 0).length !== 1 ? 's' : ''} — hide`
            : '📦 Add ingredient deductions'}
        </Text>
      </TouchableOpacity>

      {/* Inline recipe builder */}
      {showRecipe && (
        <View style={mr.recipeSection}>
          {stockItems.length === 0 ? (
            <Text style={mr.noStock}>No active stock items. Create some in Stock Management first.</Text>
          ) : (
            <>
              {lines.map((line, li) => {
                const linked = stockItems.find((s) => s.id === line.stock_item_id);
                return (
                  <View key={li} style={mr.recipeLine}>
                    {/* Stock item chips */}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={mr.chipScroll}>
                      <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
                        {stockItems.map((si) => (
                          <TouchableOpacity
                            key={si.id}
                            style={[mr.chip, line.stock_item_id === si.id && mr.chipSel]}
                            onPress={() => updateLine(li, { stock_item_id: si.id })}
                            activeOpacity={0.7}
                          >
                            <Text style={[mr.chipText, line.stock_item_id === si.id && mr.chipTextSel]}>
                              {si.name}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                    {/* Qty + unit + remove */}
                    <View style={mr.qtyRow}>
                      <TextInput
                        style={mr.qtyInput}
                        value={line.quantity_required === 0 ? '' : String(line.quantity_required)}
                        onChangeText={(v) => updateLine(li, { quantity_required: parseFloat(v) || 0 })}
                        keyboardType="decimal-pad"
                        placeholder="Qty"
                        placeholderTextColor={Colors.gray400}
                      />
                      <Text style={mr.unitLabel}>{linked?.unit ?? '—'}</Text>
                      <TouchableOpacity style={mr.removeLineBtn} onPress={() => removeLine(li)} activeOpacity={0.7} hitSlop={8}>
                        <Text style={mr.removeText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
              <TouchableOpacity style={mr.addLineBtn} onPress={addLine} activeOpacity={0.7}>
                <Text style={mr.addLineBtnText}>+ Add Ingredient</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sec.root}>
      <Text style={sec.title}>{title}</Text>
      <View style={sec.card}>{children}</View>
    </View>
  );
}

function Field({
  label, hint, required, children,
}: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View style={fld.root}>
      <View style={fld.labelRow}>
        <Text style={fld.label}>{label}</Text>
        {required && <Text style={fld.required}>*</Text>}
      </View>
      {!!hint && <Text style={fld.hint}>{hint}</Text>}
      {children}
    </View>
  );
}

function SwitchRow({
  label, hint, value, onChange,
}: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={sw.row}>
      <View style={sw.label}>
        <Text style={sw.text}>{label}</Text>
        {!!hint && <Text style={sw.hint}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: Colors.green600, false: Colors.gray300 }}
        thumbColor={Colors.white}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: Colors.background },
  content:  { padding: Spacing.xl, gap: Spacing.xl, paddingBottom: Spacing.xxxl },
  center:   { flex: 1, justifyContent: 'center', alignItems: 'center' },

  pageHeader: { gap: Spacing.xs },
  backText:   { fontSize: FontSize.sm, color: Colors.green700, fontWeight: FontWeight.medium },
  pageTitle:  { fontSize: FontSize.display, fontWeight: FontWeight.bold, color: Colors.gray900 },

  footer: {
    borderTopWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  errorInline: {
    backgroundColor: Colors.dangerBg,
    borderWidth: 1,
    borderColor: Colors.danger + '44',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  errorText: { fontSize: FontSize.sm, color: Colors.danger, fontWeight: FontWeight.medium },

  saveBtn: {
    backgroundColor: Colors.green600,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    minWidth: 130,
    alignItems: 'center',
    ...Shadow.sm,
  },
  saveBtnOff:  { opacity: 0.6 },
  saveBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.white },

  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: FontSize.base,
    color: Colors.gray800,
    backgroundColor: Colors.white,
  },
  row2: { flexDirection: 'row', gap: Spacing.md },

  sectionHint: { fontSize: FontSize.xs, color: Colors.gray400, marginBottom: Spacing.xs },

  addModBtn: {
    borderWidth: 1.5,
    borderColor: Colors.green600,
    borderStyle: 'dashed',
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  addModBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.green700,
  },

  dangerHint: { fontSize: FontSize.sm, color: Colors.gray500, marginBottom: Spacing.sm },
  deleteBtn: {
    borderWidth: 1.5,
    borderColor: Colors.danger,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  deleteBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.danger,
  },
});

const sec = StyleSheet.create({
  root:  { gap: Spacing.sm },
  title: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xl,
    gap: Spacing.lg,
    ...Shadow.sm,
  },
});

const fld = StyleSheet.create({
  root:     { gap: Spacing.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  label:    { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },
  required: { fontSize: FontSize.sm, color: Colors.danger },
  hint:     { fontSize: FontSize.xs, color: Colors.gray400 },
});

const sw = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { flex: 1, gap: 2 },
  text:  { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },
  hint:  { fontSize: FontSize.xs, color: Colors.gray400 },
});

const mr = StyleSheet.create({
  root: {
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.sm,
  },
  indexBadge: {
    width: rs(24),
    height: rs(24),
    borderRadius: rs(12),
    backgroundColor: Colors.gray200,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  indexText: { fontSize: FontSize.xs, fontWeight: FontWeight.bold, color: Colors.gray600 },
  fields:    { flex: 1, gap: Spacing.xs },
  nameInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.gray800,
    backgroundColor: Colors.white,
  },
  row:       { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  priceWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.white,
    paddingLeft: Spacing.sm,
    flex: 1,
  },
  pricePrefix: { fontSize: FontSize.sm, color: Colors.gray500, fontWeight: FontWeight.medium },
  priceInput: {
    flex: 1,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.gray800,
  },
  switchWrap:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  switchLabel: { fontSize: FontSize.xs, color: Colors.gray500 },
  removeBtn: {
    width: rs(28),
    height: rs(28),
    borderRadius: rs(14),
    backgroundColor: Colors.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  removeText: { fontSize: 12, color: Colors.danger, fontWeight: FontWeight.bold },

  // Recipe section
  recipeToggle: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderTopWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.gray50,
  },
  recipeToggleText: {
    fontSize: FontSize.xs,
    color: Colors.green700,
    fontWeight: FontWeight.medium,
  },
  recipeSection: {
    borderTopWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.sm,
    gap: Spacing.sm,
    backgroundColor: Colors.green50,
  },
  noStock: { fontSize: FontSize.xs, color: Colors.gray400 },
  recipeLine: {
    backgroundColor: Colors.white,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.sm,
    gap: Spacing.xs,
  },
  chipScroll: { maxHeight: rs(44) },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    height: rs(36),
    justifyContent: 'center',
  },
  chipSel:     { borderColor: Colors.green600, backgroundColor: Colors.green50 },
  chipText:    { fontSize: FontSize.sm, color: Colors.gray600, fontWeight: FontWeight.medium },
  chipTextSel: { color: Colors.green700, fontWeight: FontWeight.bold },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  qtyInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    fontSize: FontSize.sm,
    color: Colors.gray800,
    backgroundColor: Colors.white,
    width: rs(88),
    textAlign: 'center',
  },
  unitLabel: { fontSize: FontSize.sm, color: Colors.gray500, flex: 1 },
  removeLineBtn: {
    width: rs(24),
    height: rs(24),
    borderRadius: rs(12),
    backgroundColor: Colors.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLineBtn: {
    borderWidth: 1.5,
    borderColor: Colors.green600,
    borderStyle: 'dashed',
    borderRadius: Radius.sm,
    paddingVertical: Spacing.xs,
    alignItems: 'center',
  },
  addLineBtnText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.green700,
  },
});
