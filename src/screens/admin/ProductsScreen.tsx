import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AdminLayout from './AdminLayout';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { getAllCategories, getAllProducts } from '../../firebase/firestoreService';
import { useAuthStore } from '../../store/authStore';
import { Category, Product } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

type Nav = NativeStackNavigationProp<AdminStackParamList>;
type Tab = 'products' | 'categories';

export default function ProductsScreen() {
  const navigation = useNavigation<Nav>();
  const user       = useAuthStore((s) => s.user)!;
  const isAdmin    = user.role === 'admin';

  const [tab, setTab]             = useState<Tab>(isAdmin ? 'products' : 'categories');
  const [products,   setProducts]   = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading,    setLoading]    = useState(true);

  useFocusEffect(
    useCallback(() => {
      load();
    }, []),
  );

  async function load() {
    setLoading(true);
    try {
      const [prods, cats] = await Promise.all([getAllProducts(), getAllCategories()]);
      setProducts(prods);
      setCategories(cats);
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
                tab === 'products'
                  ? navigation.navigate('ProductEdit', {})
                  : navigation.navigate('CategoryEdit', {})
              }
              activeOpacity={0.8}
            >
              <Text style={s.addBtnText}>+ Add {tab === 'products' ? 'Product' : 'Category'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Tabs — admin sees both; manager sees categories only */}
        {isAdmin && (
          <View style={s.tabs}>
            {(['products', 'categories'] as Tab[]).map((t) => (
              <TouchableOpacity
                key={t}
                style={[s.tab, tab === t && s.tabActive]}
                onPress={() => setTab(t)}
                activeOpacity={0.7}
              >
                <Text style={[s.tabText, tab === t && s.tabTextActive]}>
                  {t === 'products' ? `Products (${products.length})` : `Categories (${categories.length})`}
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
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
            {grouped.map(({ cat, items }) =>
              items.length === 0 ? null : (
                <View key={cat.id} style={s.group}>
                  <View style={s.groupHeader}>
                    <Text style={s.groupTitle}>{cat.name}</Text>
                    {!cat.is_active && <Badge label="Inactive" color={Colors.gray400} />}
                  </View>
                  {items.map((p) => (
                    <ProductRow
                      key={p.id}
                      product={p}
                      onPress={() => navigation.navigate('ProductEdit', { productId: p.id })}
                    />
                  ))}
                </View>
              ),
            )}
            {uncategorised.length > 0 && (
              <View style={s.group}>
                <Text style={s.groupTitle}>Uncategorised</Text>
                {uncategorised.map((p) => (
                  <ProductRow
                    key={p.id}
                    product={p}
                    onPress={() => navigation.navigate('ProductEdit', { productId: p.id })}
                  />
                ))}
              </View>
            )}
            {products.length === 0 && (
              <View style={s.empty}>
                <Text style={s.emptyText}>No products yet. Tap "+ Add Product" to create one.</Text>
              </View>
            )}
          </ScrollView>
        ) : (
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
            {categories.map((cat) => (
              <CategoryRow
                key={cat.id}
                category={cat}
                count={products.filter((p) => p.category_id === cat.id).length}
                onPress={isAdmin ? () => navigation.navigate('CategoryEdit', { categoryId: cat.id }) : undefined}
              />
            ))}
            {categories.length === 0 && (
              <View style={s.empty}>
                <Text style={s.emptyText}>No categories yet. Tap "+ Add Category" to create one.</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
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
  empty:     { paddingTop: Spacing.xxxl, alignItems: 'center' },
  emptyText: { fontSize: FontSize.base, color: Colors.gray400 },
});

const pr = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
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
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  text: { fontSize: 10, fontWeight: FontWeight.bold },
});
