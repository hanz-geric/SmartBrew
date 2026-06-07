import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, ScrollView, SectionList,
  StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AdminLayout from './AdminLayout';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { getAllCategories, getAllModifierGroups, getAllProducts, upsertCategory } from '../../firebase/firestoreService';
import { useAuthStore } from '../../store/authStore';
import { Category, ModifierGroup, Product } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

type Nav = NativeStackNavigationProp<AdminStackParamList>;
type Tab = 'products' | 'categories' | 'modifiers';

export default function ProductsScreen() {
  const navigation = useNavigation<Nav>();
  const user       = useAuthStore((s) => s.user)!;
  const isAdmin    = user.role === 'admin';

  const [tab, setTab]             = useState<Tab>(isAdmin ? 'products' : 'categories');
  const [products,   setProducts]   = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups,     setGroups]     = useState<ModifierGroup[]>([]);
  const [loading,    setLoading]    = useState(true);

  // Category edit modal state
  const [catModal,      setCatModal]      = useState<{ id?: string } | null>(null);
  const [catName,       setCatName]       = useState('');
  const [catSortOrder,  setCatSortOrder]  = useState('0');
  const [catIsActive,   setCatIsActive]   = useState(true);
  const [catSaving,     setCatSaving]     = useState(false);
  const [catError,      setCatError]      = useState('');

  function openCatNew() {
    setCatName(''); setCatSortOrder('0'); setCatIsActive(true); setCatError('');
    setCatModal({});
  }

  function openCatEdit(cat: Category) {
    setCatName(cat.name); setCatSortOrder(String(cat.sort_order));
    setCatIsActive(cat.is_active); setCatError('');
    setCatModal({ id: cat.id });
  }

  async function handleCatSave() {
    const trimmed = catName.trim();
    const sortNum = parseInt(catSortOrder, 10);
    if (!trimmed) { setCatError('Name is required.'); return; }
    if (isNaN(sortNum) || sortNum < 0) { setCatError('Sort order must be 0 or higher.'); return; }
    setCatSaving(true);
    setCatError('');
    try {
      await upsertCategory({ name: trimmed, sort_order: sortNum, is_active: catIsActive }, catModal?.id);
      setCatModal(null);
      load();
    } catch (e: unknown) {
      setCatError((e as { code?: string }).code === 'permission-denied' ? 'Permission denied.' : 'Failed to save.');
    } finally {
      setCatSaving(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, []),
  );

  async function load() {
    setLoading(true);
    try {
      const [prods, cats, mods] = await Promise.all([
        getAllProducts(), getAllCategories(), getAllModifierGroups(),
      ]);
      setProducts(prods);
      setCategories(cats);
      setGroups(mods);
    } finally {
      setLoading(false);
    }
  }

  const grouped = categories.map((cat) => ({
    cat,
    items: products.filter((p) => p.category_id === cat.id),
  }));
  const uncategorised = products.filter(
    (p) => !categories.some((c) => c.id === p.category_id),
  );

  return (
    <AdminLayout active="Products">
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>{isAdmin ? 'Menu Management' : 'Categories'}</Text>
          {isAdmin && (
            <TouchableOpacity
              style={s.addBtn}
              onPress={() =>
                tab === 'products'  ? navigation.navigate('ProductEdit', {}) :
                tab === 'modifiers' ? navigation.navigate('ModifierGroupEdit', {}) :
                openCatNew()
              }
              activeOpacity={0.8}
            >
              <Text style={s.addBtnText}>
                + Add {tab === 'products' ? 'Product' : tab === 'modifiers' ? 'Group' : 'Category'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Tabs — admin sees all three; manager sees categories only */}
        {isAdmin && (
          <View style={s.tabs}>
            {(['products', 'categories', 'modifiers'] as Tab[]).map((t) => (
              <TouchableOpacity
                key={t}
                style={[s.tab, tab === t && s.tabActive]}
                onPress={() => setTab(t)}
                activeOpacity={0.7}
              >
                <Text style={[s.tabText, tab === t && s.tabTextActive]}>
                  {t === 'products'   ? `Products (${products.length})` :
                   t === 'categories' ? `Categories (${categories.length})` :
                                       `Modifiers (${groups.length})`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={Colors.green600} />
          </View>
        ) : tab === 'products' ? (
          <SectionList
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            sections={[
              ...grouped
                .filter(({ items }) => items.length > 0)
                .map(({ cat, items }) => ({ key: cat.id, title: cat.name, inactive: !cat.is_active, data: items })),
              ...(uncategorised.length > 0
                ? [{ key: 'uncategorised', title: 'Uncategorised', inactive: false, data: uncategorised }]
                : []),
            ]}
            keyExtractor={(p) => p.id}
            renderSectionHeader={({ section }) => (
              <View style={s.groupHeader}>
                <Text style={s.groupTitle}>{section.title}</Text>
                {section.inactive && <Badge label="Inactive" color={Colors.gray400} />}
              </View>
            )}
            renderItem={({ item }) => (
              <ProductRow
                product={item}
                onPress={() => navigation.navigate('ProductEdit', { productId: item.id })}
              />
            )}
            SectionSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
            ListEmptyComponent={
              <View style={s.empty}>
                <Text style={s.emptyText}>No products yet. Tap "+ Add Product" to create one.</Text>
              </View>
            }
          />
        ) : tab === 'categories' ? (
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
            {categories.map((cat) => (
              <CategoryRow
                key={cat.id}
                category={cat}
                count={products.filter((p) => p.category_id === cat.id).length}
                onPress={isAdmin ? () => openCatEdit(cat) : undefined}
              />
            ))}
            {categories.length === 0 && (
              <View style={s.empty}>
                <Text style={s.emptyText}>No categories yet. Tap "+ Add Category" to create one.</Text>
              </View>
            )}
          </ScrollView>
        ) : (
          <>
            <Text style={s.modSubtitle}>
              Modifier groups define the options customers pick from (e.g. Size: Small, Medium, Large). Assign them to products in the Products tab.
            </Text>
            <FlatList
              data={groups}
              keyExtractor={(g) => g.id}
              style={s.scroll}
              contentContainerStyle={s.scrollContent}
              renderItem={({ item: g }) => (
                <GroupCard
                  group={g}
                  onPress={() => navigation.navigate('ModifierGroupEdit', { groupId: g.id })}
                />
              )}
              ListEmptyComponent={
                <View style={s.empty}>
                  <Text style={s.emptyText}>No modifier groups yet. Tap "+ Add Group" to create one.</Text>
                </View>
              }
            />
          </>
        )}
      </View>

      {/* Category Edit Modal */}
      <Modal
        visible={catModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setCatModal(null)}
      >
        <KeyboardAvoidingView
          style={cm.overlay}
          behavior={Platform.OS === 'android' ? 'height' : 'padding'}
        >
          <View style={cm.sheet}>
            {/* Header */}
            <View style={cm.header}>
              <Text style={cm.title}>{catModal?.id ? 'Edit Category' : 'New Category'}</Text>
              <TouchableOpacity onPress={() => setCatModal(null)} hitSlop={12} activeOpacity={0.7}>
                <Text style={cm.closeX}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Body */}
            <ScrollView style={cm.body} contentContainerStyle={cm.bodyContent} keyboardShouldPersistTaps="handled">
              <View style={cm.field}>
                <Text style={cm.label}>Category Name <Text style={cm.required}>*</Text></Text>
                <TextInput
                  style={cm.input}
                  value={catName}
                  onChangeText={setCatName}
                  placeholder="e.g. Hot Drinks"
                  placeholderTextColor={Colors.gray400}
                />
              </View>

              <View style={cm.field}>
                <Text style={cm.label}>Sort Order</Text>
                <Text style={cm.hint}>Lower numbers appear first in the POS</Text>
                <TextInput
                  style={cm.input}
                  value={catSortOrder}
                  onChangeText={setCatSortOrder}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={Colors.gray400}
                />
              </View>

              <View style={cm.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={cm.label}>Active</Text>
                  <Text style={cm.hint}>Inactive categories are hidden from the POS</Text>
                </View>
                <Switch
                  value={catIsActive}
                  onValueChange={setCatIsActive}
                  trackColor={{ true: Colors.green600, false: Colors.gray300 }}
                  thumbColor={Colors.white}
                />
              </View>

              {!!catError && <Text style={cm.error}>{catError}</Text>}
            </ScrollView>

            {/* Footer */}
            <View style={cm.footer}>
              <TouchableOpacity style={cm.cancelBtn} onPress={() => setCatModal(null)} disabled={catSaving}>
                <Text style={cm.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[cm.saveBtn, catSaving && cm.saveBtnOff]}
                onPress={handleCatSave}
                disabled={catSaving}
                activeOpacity={0.8}
              >
                {catSaving
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={cm.saveBtnText}>{catModal?.id ? 'Save' : 'Create'}</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </AdminLayout>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProductRow({ product, onPress }: { product: Product; onPress: () => void }) {
  return (
    <TouchableOpacity style={pr.row} onPress={onPress} activeOpacity={0.7}>
      <View style={pr.main}>
        <View style={pr.nameRow}>
          <Text style={pr.name}>{product.name}</Text>
          {!product.is_active && <Badge label="Inactive" color={Colors.gray400} />}
          {product.needs_kitchen && <Badge label="Kitchen" color={Colors.warning} />}
        </View>
        {product.modifier_groups.length > 0 && (
          <Text style={pr.hint}>
            {product.modifier_groups.length} modifier group{product.modifier_groups.length > 1 ? 's' : ''}
          </Text>
        )}
      </View>
      <View style={pr.right}>
        <Text style={pr.price}>₱{product.price.toFixed(2)}</Text>
        <Text style={pr.cost}>cost ₱{product.cost.toFixed(2)}</Text>
      </View>
      <Text style={pr.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function CategoryRow({
  category, count, onPress,
}: { category: Category; count: number; onPress?: () => void }) {
  return (
    <TouchableOpacity style={cr.row} onPress={onPress} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress}>
      <View style={cr.main}>
        <View style={cr.nameRow}>
          <Text style={cr.name}>{category.name}</Text>
          {!category.is_active && <Badge label="Inactive" color={Colors.gray400} />}
        </View>
        <Text style={cr.hint}>{count} product{count !== 1 ? 's' : ''} · order #{category.sort_order}</Text>
      </View>
      {onPress && <Text style={cr.chevron}>›</Text>}
    </TouchableOpacity>
  );
}

function GroupCard({ group, onPress }: { group: ModifierGroup; onPress: () => void }) {
  const active   = group.modifiers.filter((m) => m.is_active !== false);
  const inactive = group.modifiers.filter((m) => m.is_active === false);

  return (
    <TouchableOpacity style={gc.card} onPress={onPress} activeOpacity={0.7}>
      <View style={gc.header}>
        <View style={gc.titleRow}>
          <Text style={gc.name}>{group.name}</Text>
          {group.is_active === false && (
            <View style={[gc.badge, { backgroundColor: Colors.gray200, borderColor: Colors.gray400 }]}>
              <Text style={[gc.badgeText, { color: Colors.gray500 }]}>Inactive</Text>
            </View>
          )}
          {group.is_required && (
            <View style={[gc.badge, { backgroundColor: Colors.green50, borderColor: Colors.green600 }]}>
              <Text style={[gc.badgeText, { color: Colors.green700 }]}>Required</Text>
            </View>
          )}
        </View>
        <View style={gc.meta}>
          <Text style={gc.metaText}>
            Max select: {group.max_select} · {group.modifiers.length} option{group.modifiers.length !== 1 ? 's' : ''}
            {inactive.length > 0 ? ` (${inactive.length} inactive)` : ''}
          </Text>
        </View>
      </View>

      <View style={gc.divider} />

      <View style={gc.modifiers}>
        {active.map((m) => (
          <View key={m.id} style={gc.modRow}>
            <Text style={gc.modName}>{m.name}</Text>
            <Text style={gc.modPrice}>
              {m.price_delta === 0 ? 'free' : `+₱${m.price_delta.toFixed(2)}`}
            </Text>
          </View>
        ))}
        {group.modifiers.length === 0 && (
          <Text style={gc.noMods}>No modifiers — tap to add some.</Text>
        )}
      </View>

      <Text style={gc.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[bdg.root, { backgroundColor: color + '22', borderColor: color }]}>
      <Text style={[bdg.text, { color }]}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  title: {
    fontSize: FontSize.display,
    fontWeight: FontWeight.bold,
    color: Colors.gray900,
  },
  addBtn: {
    backgroundColor: Colors.green600,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    ...Shadow.sm,
  },
  addBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  tab: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  tabActive: {
    borderColor: Colors.green600,
    backgroundColor: Colors.green50,
  },
  tabText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.gray600,
  },
  tabTextActive: {
    color: Colors.green700,
    fontWeight: FontWeight.bold,
  },
  scroll:        { flex: 1 },
  scrollContent: { padding: Spacing.xl, gap: Spacing.xl, paddingTop: 0 },
  center:        { flex: 1, justifyContent: 'center', alignItems: 'center' },
  group:         { gap: Spacing.xs },
  groupHeader:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  groupTitle:    {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  empty:       { paddingTop: Spacing.xxxl, alignItems: 'center' },
  emptyText:   { fontSize: FontSize.base, color: Colors.gray400 },
  modSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
    lineHeight: 18,
  },
});

const pr = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  main:    { flex: 1, gap: Spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  name:    { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray900 },
  hint:    { fontSize: FontSize.xs, color: Colors.gray400 },
  right:   { alignItems: 'flex-end', gap: 2 },
  price:   { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.gray900 },
  cost:    { fontSize: FontSize.xs, color: Colors.gray400 },
  chevron: { fontSize: 20, color: Colors.gray400, marginLeft: Spacing.xs },
});

const cr = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  main:    { flex: 1, gap: Spacing.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name:    { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray900 },
  hint:    { fontSize: FontSize.xs, color: Colors.gray400 },
  chevron: { fontSize: 20, color: Colors.gray400 },
});

const bdg = StyleSheet.create({
  root: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  text: { fontSize: FontSize.xs, fontWeight: FontWeight.bold },
});

const gc = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    gap: Spacing.sm,
    ...Shadow.sm,
  },
  header:   { gap: Spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  name:     { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.gray900 },
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  badgeText: { fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  meta:     {},
  metaText: { fontSize: FontSize.xs, color: Colors.gray400 },
  divider:  { height: 1, backgroundColor: Colors.border },
  modifiers: { gap: 4 },
  modRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modName:  { fontSize: FontSize.sm, color: Colors.gray700, fontWeight: FontWeight.medium },
  modPrice: { fontSize: FontSize.sm, color: Colors.gray400 },
  noMods:   { fontSize: FontSize.sm, color: Colors.gray400, fontStyle: 'italic' },
  chevron: {
    position: 'absolute',
    right: Spacing.lg,
    top: Spacing.lg,
    fontSize: 20,
    color: Colors.gray400,
  },
});

const cm = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center', padding: Spacing.xl,
  },
  sheet: {
    width: '100%', maxWidth: 440,
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    overflow: 'hidden', ...Shadow.lg,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.green700, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
  },
  title:  { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.white },
  closeX: { fontSize: FontSize.lg, color: Colors.white, fontWeight: FontWeight.bold },

  body: { flex: 1 },
  bodyContent: { padding: Spacing.xl, gap: Spacing.lg },

  field:    { gap: Spacing.xs },
  label:    { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },
  hint:     { fontSize: FontSize.xs, color: Colors.gray400 },
  required: { color: Colors.danger },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    fontSize: FontSize.base, color: Colors.gray800, backgroundColor: Colors.white,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  error:     { fontSize: FontSize.sm, color: Colors.danger },

  footer: {
    flexDirection: 'row', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl,
    paddingTop: Spacing.sm,
  },
  cancelBtn: {
    flex: 1, paddingVertical: Spacing.md, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center',
  },
  cancelText:  { fontSize: FontSize.base, fontWeight: FontWeight.medium, color: Colors.gray600 },
  saveBtn: {
    flex: 2, paddingVertical: Spacing.md, borderRadius: Radius.md,
    backgroundColor: Colors.green600, alignItems: 'center', ...Shadow.sm,
  },
  saveBtnOff:  { opacity: 0.6 },
  saveBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.white },
});
