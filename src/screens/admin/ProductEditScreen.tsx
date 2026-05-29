import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Switch, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import AdminLayout from './AdminLayout';
import { AdminStackParamList } from '../../navigation/AdminStack';
import {
  getAllCategories, getAllModifierGroups, getAllProducts, listStockItems, upsertProduct,
} from '../../firebase/firestoreService';
import { uploadProductImage } from '../../firebase/storageService';
import { Category, ModifierGroup, RecipeLine, StockItem, TrackingMode } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

type Nav   = NativeStackNavigationProp<AdminStackParamList>;
type Route = RouteProp<AdminStackParamList, 'ProductEdit'>;

export default function ProductEditScreen() {
  const navigation = useNavigation<Nav>();
  const route      = useRoute<Route>();
  const { productId } = route.params;
  const isNew = !productId;

  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  // Form state
  const [name,          setName]          = useState('');
  const [price,         setPrice]         = useState('');
  const [cost,          setCost]          = useState('');
  const [categoryId,    setCategoryId]    = useState('');
  const [trackingMode,  setTrackingMode]  = useState<TrackingMode>('none');
  const [needsKitchen,  setNeedsKitchen]  = useState(false);
  const [isActive,      setIsActive]      = useState(true);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [stockItemId,    setStockItemId]    = useState<string | null>(null);
  // image: null | remote https:// URL (saved) | local file:// URI (pending upload)
  const [image,         setImage]         = useState<string | null>(null);
  // recipe lines (for tracking_mode === 'recipe')
  const [recipeLines,   setRecipeLines]   = useState<RecipeLine[]>([]);

  // Reference data
  const [categories,     setCategories]     = useState<Category[]>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [stockItems,     setStockItems]     = useState<StockItem[]>([]);

  useEffect(() => { load(); }, []);

  // Auto-calculate cost from recipe when in recipe mode
  useEffect(() => {
    if (trackingMode !== 'recipe') return;
    const total = recipeLines.reduce((sum, line) => {
      const item = stockItems.find((s) => s.id === line.stock_item_id);
      return sum + (item?.cost_per_unit ?? 0) * line.quantity_required;
    }, 0);
    setCost(total.toFixed(4));
  }, [recipeLines, stockItems, trackingMode]);

  async function load() {
    try {
      const [cats, groups, items] = await Promise.all([
        getAllCategories(), getAllModifierGroups(), listStockItems(),
      ]);
      setCategories(cats);
      setModifierGroups(groups);
      setStockItems(items.filter((i) => i.is_active));

      if (!isNew) {
        const prods = await getAllProducts();
        const prod  = prods.find((p) => p.id === productId);
        if (!prod) { setError('Product not found.'); return; }
        setName(prod.name);
        setPrice(String(prod.price));
        setCost(String(prod.cost));
        setCategoryId(prod.category_id);
        setTrackingMode(prod.tracking_mode);
        setStockItemId(prod.stock_item_id);
        setNeedsKitchen(prod.needs_kitchen);
        setIsActive(prod.is_active);
        setSelectedGroups(prod.modifier_groups.map((g) => g.id));
        setImage(prod.image ?? null);
        setRecipeLines(prod.recipe_lines ?? []);
      } else if (cats.length > 0) {
        setCategoryId(cats[0].id);
      }
    } catch {
      setError('Failed to load data.');
    } finally {
      setLoading(false);
    }
  }

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Gallery permission is required to pick an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets.length > 0) {
      setImage(result.assets[0].uri);
      setError('');
    }
  }

  async function handleSave() {
    setError('');
    const trimmed   = name.trim();
    const priceNum  = parseFloat(price);
    const costNum   = parseFloat(cost) || 0;

    if (!trimmed)          { setError('Name is required.'); return; }
    if (isNaN(priceNum) || priceNum < 0) { setError('Enter a valid price.'); return; }
    if (costNum < 0)       { setError('Cost cannot be negative.'); return; }
    if (!categoryId)       { setError('Select a category.'); return; }
    if (trackingMode === 'direct' && !stockItemId) { setError('Select a linked stock item for direct tracking.'); return; }
    if (trackingMode === 'recipe' && recipeLines.length === 0) { setError('Add at least one ingredient for recipe tracking.'); return; }
    if (trackingMode === 'recipe' && recipeLines.some((l) => !l.stock_item_id || l.quantity_required <= 0)) {
      setError('Each ingredient must have a stock item and a quantity greater than 0.');
      return;
    }

    const selectedCat   = categories.find((c) => c.id === categoryId);
    const builtGroups   = modifierGroups
      .filter((g) => selectedGroups.includes(g.id))
      .map((g) => ({
        id:          g.id,
        name:        g.name,
        is_required: g.is_required,
        max_select:  g.max_select,
        modifiers:   g.modifiers,
      }));

    setSaving(true);
    try {
      const builtRecipe = trackingMode === 'recipe' ? recipeLines : [];
      const baseData = {
        name:            trimmed,
        price:           priceNum,
        cost:            costNum,
        category_id:     categoryId,
        category_name:   selectedCat?.name ?? '',
        tracking_mode:   trackingMode,
        stock_item_id:   trackingMode === 'direct' ? (stockItemId ?? null) : null,
        recipe_lines:    builtRecipe,
        needs_kitchen:   needsKitchen,
        is_active:       isActive,
        modifier_groups: builtGroups,
      };

      let finalImage = image;
      if (image && !image.startsWith('https://')) {
        // For new products, save without image first to get the Firestore ID,
        // then upload once under the real ID — avoids the orphaned temp-key file.
        const targetId = productId ?? await upsertProduct({ ...baseData, image: null }, undefined);
        finalImage = await uploadProductImage(image, targetId);
        await upsertProduct({ ...baseData, image: finalImage }, targetId);
      } else {
        await upsertProduct({ ...baseData, image: finalImage }, productId);
      }

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

  function toggleGroup(id: string) {
    setSelectedGroups((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  if (loading) {
    return (
      <AdminLayout active="Products">
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.green600} />
        </View>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout active="Products">
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={s.pageHeader}>
            <View style={s.headerLeft}>
              <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
                <Text style={s.backText}>‹ Back</Text>
              </TouchableOpacity>
              <Text style={s.pageTitle}>{isNew ? 'New Product' : 'Edit Product'}</Text>
            </View>
            <View style={s.headerRight}>
              {!!error && <Text style={s.errorText}>{error}</Text>}
              <TouchableOpacity
                style={[s.saveBtn, saving && s.saveBtnOff]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={s.saveBtnText}>{isNew ? 'Create' : 'Save Changes'}</Text>
                }
              </TouchableOpacity>
            </View>
          </View>

          {/* Product image */}
          <Section title="Product Image">
            <View style={img.row}>
              <TouchableOpacity style={img.preview} onPress={pickImage} activeOpacity={0.8}>
                {image ? (
                  <Image source={{ uri: image }} style={img.previewImg} resizeMode="cover" />
                ) : (
                  <View style={img.previewEmpty}>
                    <Text style={img.previewEmoji}>☕</Text>
                    <Text style={img.previewHint}>Tap to add image</Text>
                  </View>
                )}
              </TouchableOpacity>
              <View style={img.actions}>
                <TouchableOpacity style={img.btn} onPress={pickImage} activeOpacity={0.8}>
                  <Text style={img.btnText}>{image ? 'Change Image' : 'Upload Image'}</Text>
                </TouchableOpacity>
                {image && (
                  <TouchableOpacity
                    style={[img.btn, img.btnDanger]}
                    onPress={() => setImage(null)}
                    activeOpacity={0.8}
                  >
                    <Text style={[img.btnText, img.btnTextDanger]}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </Section>

          {/* Basic info */}
          <Section title="Product Info">
            <Field label="Name" required>
              <TextInput
                style={s.input}
                value={name}
                onChangeText={setName}
                placeholder="e.g. Caramel Latte"
                placeholderTextColor={Colors.gray400}
              />
            </Field>

            <View style={s.row2}>
              <View style={{ flex: 1 }}>
                <Field label="Selling Price (₱)" required>
                  <TextInput
                    style={s.input}
                    value={price}
                    onChangeText={setPrice}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={Colors.gray400}
                  />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label={trackingMode === 'recipe' ? 'Cost ₱ (auto from recipe)' : 'Cost (₱)'}
                  hint="Used for profit reporting"
                >
                  <TextInput
                    style={[s.input, trackingMode === 'recipe' && s.inputReadonly]}
                    value={cost}
                    onChangeText={setCost}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={Colors.gray400}
                    editable={trackingMode !== 'recipe'}
                  />
                </Field>
              </View>
            </View>

            <Field label="Category" required>
              <View style={s.optionGroup}>
                {categories.map((cat) => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[s.optionBtn, categoryId === cat.id && s.optionBtnSel]}
                    onPress={() => setCategoryId(cat.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.optionText, categoryId === cat.id && s.optionTextSel]}>
                      {cat.name}
                    </Text>
                  </TouchableOpacity>
                ))}
                {categories.length === 0 && (
                  <Text style={s.noOptionText}>No categories. Create one first.</Text>
                )}
              </View>
            </Field>
          </Section>

          {/* Options */}
          <Section title="Options">
            <SwitchRow
              label="Needs Kitchen Ticket"
              hint="Send this item to the kitchen printer when ordered"
              value={needsKitchen}
              onChange={setNeedsKitchen}
            />

            <Field label="Stock Tracking" hint="How this product's inventory is tracked">
              <View style={s.optionGroup}>
                {([
                  ['none',   'None',          'No tracking'],
                  ['direct', 'Direct',        'Track stock directly on this product'],
                  ['recipe', 'Recipe-based',  'Deduct from ingredient stock items'],
                ] as [TrackingMode, string, string][]).map(([val, label, hint]) => (
                  <TouchableOpacity
                    key={val}
                    style={[s.optionBtn, trackingMode === val && s.optionBtnSel]}
                    onPress={() => setTrackingMode(val)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.optionText, trackingMode === val && s.optionTextSel]}>{label}</Text>
                    <Text style={[s.optionHint, trackingMode === val && s.optionHintSel]}>{hint}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Field>

            {/* Linked stock item picker — shown only for direct tracking */}
            {trackingMode === 'direct' && (
              <Field label="Linked Stock Item" required>
                {stockItems.length === 0 ? (
                  <Text style={s.noOptionText}>No active stock items. Create one in Stock Management.</Text>
                ) : (
                  <View style={s.optionGroup}>
                    {stockItems.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={[s.optionBtn, stockItemId === item.id && s.optionBtnSel]}
                        onPress={() => setStockItemId(item.id)}
                        activeOpacity={0.7}
                      >
                        <Text style={[s.optionText, stockItemId === item.id && s.optionTextSel]}>
                          {item.name}
                        </Text>
                        <Text style={[s.optionHint, stockItemId === item.id && s.optionHintSel]}>
                          {item.quantity_on_hand} {item.unit} on hand
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </Field>
            )}

            {/* Recipe builder — shown only for recipe tracking */}
            {trackingMode === 'recipe' && (
              <Field label="Recipe Ingredients" required hint="Define what is consumed when 1 unit of this product is sold.">
                {stockItems.length === 0 ? (
                  <Text style={s.noOptionText}>No active stock items. Create some in Stock Management first.</Text>
                ) : (
                  <View style={rb.container}>
                    {recipeLines.map((line, idx) => {
                      const linkedItem = stockItems.find((si) => si.id === line.stock_item_id);
                      return (
                        <View key={idx} style={rb.row}>
                          {/* Stock item picker */}
                          <View style={rb.pickerWrap}>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                              <View style={{ flexDirection: 'row', gap: Spacing.xs }}>
                                {stockItems.map((si) => (
                                  <TouchableOpacity
                                    key={si.id}
                                    style={[rb.chip, line.stock_item_id === si.id && rb.chipSel]}
                                    onPress={() => {
                                      const updated = [...recipeLines];
                                      updated[idx] = { ...updated[idx], stock_item_id: si.id };
                                      setRecipeLines(updated);
                                    }}
                                    activeOpacity={0.7}
                                  >
                                    <Text style={[rb.chipText, line.stock_item_id === si.id && rb.chipTextSel]}>
                                      {si.name}
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                            </ScrollView>
                          </View>
                          {/* Qty + unit */}
                          <View style={rb.qtyRow}>
                            <TextInput
                              style={rb.qtyInput}
                              value={String(line.quantity_required || '')}
                              onChangeText={(v) => {
                                const updated = [...recipeLines];
                                updated[idx] = { ...updated[idx], quantity_required: parseFloat(v) || 0 };
                                setRecipeLines(updated);
                              }}
                              keyboardType="decimal-pad"
                              placeholder="Qty"
                              placeholderTextColor={Colors.gray400}
                            />
                            <Text style={rb.unitLabel}>{linkedItem?.unit ?? '—'}</Text>
                            <TouchableOpacity
                              style={rb.removeBtn}
                              onPress={() => setRecipeLines(recipeLines.filter((_, i) => i !== idx))}
                              activeOpacity={0.7}
                            >
                              <Text style={rb.removeBtnText}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                    <TouchableOpacity
                      style={rb.addBtn}
                      onPress={() => setRecipeLines([...recipeLines, { stock_item_id: '', quantity_required: 0 }])}
                      activeOpacity={0.8}
                    >
                      <Text style={rb.addBtnText}>+ Add Ingredient</Text>
                    </TouchableOpacity>
                    {recipeLines.length > 0 && (
                      <Text style={rb.costPreview}>
                        Auto cost: ₱{recipeLines.reduce((sum, line) => {
                          const si = stockItems.find((s) => s.id === line.stock_item_id);
                          return sum + (si?.cost_per_unit ?? 0) * (line.quantity_required || 0);
                        }, 0).toFixed(4)}
                      </Text>
                    )}
                  </View>
                )}
              </Field>
            )}

            <SwitchRow
              label="Active"
              hint="Inactive products are hidden from the POS"
              value={isActive}
              onChange={setIsActive}
            />
          </Section>

          {/* Modifier groups */}
          <Section title="Modifier Groups">
            {modifierGroups.length === 0 ? (
              <Text style={s.noOptionText}>No modifier groups defined in the database.</Text>
            ) : (
              modifierGroups.map((g) => {
                const selected = selectedGroups.includes(g.id);
                return (
                  <TouchableOpacity
                    key={g.id}
                    style={[s.modRow, selected && s.modRowSel]}
                    onPress={() => toggleGroup(g.id)}
                    activeOpacity={0.7}
                  >
                    <View style={s.modCheck}>
                      {selected && <Text style={s.modCheckMark}>✓</Text>}
                    </View>
                    <View style={s.modInfo}>
                      <Text style={[s.modName, selected && s.modNameSel]}>{g.name}</Text>
                      <Text style={s.modHint}>
                        {g.is_required ? 'Required' : 'Optional'} · max {g.max_select} · {g.modifiers.length} options
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </AdminLayout>
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

  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  headerLeft:  { gap: Spacing.xs },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flexWrap: 'wrap' },
  backBtn:     {},
  backText:    { fontSize: FontSize.sm, color: Colors.green700, fontWeight: FontWeight.medium },
  pageTitle:   { fontSize: FontSize.display, fontWeight: FontWeight.bold, color: Colors.gray900 },

  errorText:  { fontSize: FontSize.sm, color: Colors.danger, maxWidth: 280 },

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
  inputReadonly: {
    backgroundColor: Colors.gray100,
    color: Colors.gray500,
  },

  row2: {
    flexDirection: 'row',
    gap: Spacing.md,
  },

  optionGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  optionBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: 2,
  },
  optionBtnSel: {
    borderColor: Colors.green600,
    backgroundColor: Colors.green50,
  },
  optionText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.gray600,
  },
  optionTextSel: {
    color: Colors.green700,
    fontWeight: FontWeight.bold,
  },
  optionHint: {
    fontSize: FontSize.xs,
    color: Colors.gray400,
  },
  optionHintSel: {
    color: Colors.green600,
  },
  noOptionText: { fontSize: FontSize.sm, color: Colors.gray400 },

  modRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  modRowSel: {
    borderColor: Colors.green600,
    backgroundColor: Colors.green50,
  },
  modCheck: {
    width: 22,
    height: 22,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modCheckMark: { fontSize: 13, color: Colors.green700, fontWeight: FontWeight.bold },
  modInfo:      { flex: 1, gap: 2 },
  modName:      { fontSize: FontSize.base, fontWeight: FontWeight.medium, color: Colors.gray700 },
  modNameSel:   { color: Colors.green700, fontWeight: FontWeight.semibold },
  modHint:      { fontSize: FontSize.xs, color: Colors.gray400 },
});

const rb = StyleSheet.create({
  container: {
    gap: Spacing.md,
  },
  row: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  pickerWrap: {
    maxHeight: 40,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    height: 32,
    justifyContent: 'center',
  },
  chipSel: {
    borderColor: Colors.green600,
    backgroundColor: Colors.green50,
  },
  chipText: {
    fontSize: FontSize.sm,
    color: Colors.gray600,
    fontWeight: FontWeight.medium,
  },
  chipTextSel: {
    color: Colors.green700,
    fontWeight: FontWeight.bold,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  qtyInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.sm,
    color: Colors.gray800,
    backgroundColor: Colors.white,
    width: 80,
  },
  unitLabel: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
    flex: 1,
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.gray100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
    fontWeight: FontWeight.bold,
  },
  addBtn: {
    borderWidth: 1.5,
    borderColor: Colors.green600,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderStyle: 'dashed',
  },
  addBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.green700,
  },
  costPreview: {
    fontSize: FontSize.xs,
    color: Colors.green700,
    fontWeight: FontWeight.medium,
    textAlign: 'right',
  },
});

const img = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xl,
  },
  preview: {
    width: 100,
    height: 100,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.green50,
  },
  previewImg: {
    width: '100%',
    height: '100%',
  },
  previewEmpty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  previewEmoji: {
    fontSize: 32,
  },
  previewHint: {
    fontSize: FontSize.xs,
    color: Colors.gray400,
    textAlign: 'center',
  },
  actions: {
    flex: 1,
    gap: Spacing.sm,
  },
  btn: {
    borderWidth: 1.5,
    borderColor: Colors.green600,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  btnDanger: {
    borderColor: Colors.danger,
  },
  btnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.green700,
  },
  btnTextDanger: {
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
