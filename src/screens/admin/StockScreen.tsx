import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Modal, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AdminLayout from './AdminLayout';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { listStockItems, adjustStockItem } from '../../firebase/firestoreService';
import { useAuthStore } from '../../store/authStore';
import { StockItem } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

type Nav = NativeStackNavigationProp<AdminStackParamList>;

type StatusFilter = 'all' | 'low' | 'out';

const REASONS = [
  'Restock / Delivery',
  'Waste / Spoilage',
  'Stock Correction',
  'Manual Adjustment',
] as const;
type Reason = typeof REASONS[number];

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All'       },
  { value: 'low', label: 'Low Stock' },
  { value: 'out', label: 'Out'       },
];

function statusColors(status: StockItem['stock_status']) {
  switch (status) {
    case 'out': return { bg: Colors.dangerBg,  border: Colors.danger,  text: Colors.danger  };
    case 'low': return { bg: Colors.warningBg, border: Colors.warning, text: Colors.warning };
    default:    return { bg: Colors.green50,   border: Colors.green600, text: Colors.green700 };
  }
}

function statusLabel(status: StockItem['stock_status']) {
  switch (status) {
    case 'out': return 'Out of Stock';
    case 'low': return 'Low Stock';
    default:    return 'OK';
  }
}

export default function StockScreen() {
  const navigation = useNavigation<Nav>();
  const currentUser = useAuthStore((s) => s.user)!;
  const isAdmin = currentUser.role === 'admin';

  const [items,   setItems]   = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [filter,  setFilter]  = useState<StatusFilter>('all');

  // Adjust modal state
  const [adjustTarget, setAdjustTarget] = useState<StockItem | null>(null);
  const [adjustDelta,  setAdjustDelta]  = useState('');
  const [adjustReason, setAdjustReason] = useState<Reason>(REASONS[0]);
  const [adjustNotes,  setAdjustNotes]  = useState('');
  const [adjusting,    setAdjusting]    = useState(false);
  const [adjustError,  setAdjustError]  = useState('');

  useFocusEffect(
    useCallback(() => { load(); }, []),
  );

  async function load() {
    setLoading(true);
    setError('');
    try {
      setItems(await listStockItems());
    } catch {
      setError('Failed to load stock items.');
    } finally {
      setLoading(false);
    }
  }

  function openAdjust(item: StockItem) {
    setAdjustTarget(item);
    setAdjustDelta('');
    setAdjustReason(REASONS[0]);
    setAdjustNotes('');
    setAdjustError('');
  }

  function closeAdjust() {
    setAdjustTarget(null);
    setAdjusting(false);
  }

  async function handleAdjust() {
    const delta = parseFloat(adjustDelta);
    if (!adjustDelta.trim() || isNaN(delta) || delta === 0) {
      setAdjustError('Enter a non-zero quantity (positive to add, negative to subtract).');
      return;
    }
    if (!adjustTarget) return;
    setAdjusting(true);
    setAdjustError('');
    try {
      await adjustStockItem(adjustTarget.id, delta);
      setItems((prev) => prev.map((i) => {
        if (i.id !== adjustTarget.id) return i;
        const newQty = Math.max(0, i.quantity_on_hand + delta);
        const status = newQty <= 0 ? 'out'
          : i.reorder_level > 0 && newQty <= i.reorder_level ? 'low' : 'ok';
        return { ...i, quantity_on_hand: newQty, stock_status: status };
      }));
      closeAdjust();
    } catch {
      setAdjustError('Failed to adjust stock. Check your connection.');
      setAdjusting(false);
    }
  }

  const activeItems  = items.filter((i) => i.is_active);
  const outItems     = activeItems.filter((i) => i.stock_status === 'out');
  const lowItems     = activeItems.filter((i) => i.stock_status === 'low');
  const hasAlerts    = outItems.length > 0 || lowItems.length > 0;

  const displayed = items.filter((item) => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase());
    const matchFilter =
      filter === 'all' ? true :
      filter === 'low' ? item.stock_status === 'low' :
      filter === 'out' ? item.stock_status === 'out' : true;
    return matchSearch && matchFilter;
  });

  return (
    <AdminLayout active="Stock">
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.title}>Stock</Text>
            <Text style={s.subtitle}>{activeItems.length} active items</Text>
          </View>
          {isAdmin && (
            <TouchableOpacity
              style={s.addBtn}
              onPress={() => navigation.navigate('StockEdit', {})}
              activeOpacity={0.8}
            >
              <Text style={s.addBtnText}>+ Add Item</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Alert strip */}
        {!loading && hasAlerts && (
          <View style={s.alertStrip}>
            <Text style={s.alertText}>
              ⚠️
              {outItems.length > 0 ? ` ${outItems.length} out of stock` : ''}
              {outItems.length > 0 && lowItems.length > 0 ? ' ·' : ''}
              {lowItems.length > 0 ? ` ${lowItems.length} low stock` : ''}
            </Text>
          </View>
        )}

        {/* Filters */}
        <View style={s.filterRow}>
          <TextInput
            style={s.searchInput}
            placeholder="Search items…"
            placeholderTextColor={Colors.gray400}
            value={search}
            onChangeText={setSearch}
          />
          <View style={s.statusTabs}>
            {STATUS_FILTERS.map((f) => (
              <TouchableOpacity
                key={f.value}
                style={[s.statusTab, filter === f.value && s.statusTabSel]}
                onPress={() => setFilter(f.value)}
              >
                <Text style={[s.statusTabText, filter === f.value && s.statusTabTextSel]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* List */}
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={Colors.green600} />
          </View>
        ) : error ? (
          <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>
        ) : (
          <FlatList
            data={displayed}
            keyExtractor={(i) => i.id}
            contentContainerStyle={s.listContent}
            ListEmptyComponent={
              <Text style={s.emptyText}>
                {search || filter !== 'all' ? 'No items match your filter.' : 'No stock items yet.'}
              </Text>
            }
            renderItem={({ item }) => {
              const sc = statusColors(item.stock_status);
              return (
                <View style={[s.card, !item.is_active && s.cardInactive]}>
                  <View style={s.cardMain}>
                    <View style={s.cardInfo}>
                      <View style={s.nameRow}>
                        <Text style={s.itemName}>{item.name}</Text>
                        {!item.is_active && (
                          <View style={s.inactiveBadge}>
                            <Text style={s.inactiveBadgeText}>Inactive</Text>
                          </View>
                        )}
                      </View>
                      <View style={s.qtyRow}>
                        <Text style={s.qty}>
                          {item.quantity_on_hand % 1 === 0
                            ? item.quantity_on_hand.toString()
                            : item.quantity_on_hand.toFixed(2)}{' '}
                          <Text style={s.unit}>{item.unit}</Text>
                        </Text>
                        {item.reorder_level > 0 && (
                          <Text style={s.reorderHint}>· alert at {item.reorder_level} {item.unit}</Text>
                        )}
                      </View>
                      {item.cost_per_unit > 0 && (
                        <Text style={s.costHint}>₱{item.cost_per_unit.toFixed(2)} / {item.unit}</Text>
                      )}
                    </View>

                    <View style={s.cardRight}>
                      <View style={[s.statusBadge, { backgroundColor: sc.bg, borderColor: sc.border }]}>
                        <Text style={[s.statusBadgeText, { color: sc.text }]}>
                          {statusLabel(item.stock_status)}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={s.cardActions}>
                    <TouchableOpacity
                      style={s.adjustBtn}
                      onPress={() => openAdjust(item)}
                      activeOpacity={0.7}
                    >
                      <Text style={s.adjustBtnText}>Adjust</Text>
                    </TouchableOpacity>
                    {isAdmin && (
                      <TouchableOpacity
                        style={s.editBtn}
                        onPress={() => navigation.navigate('StockEdit', { itemId: item.id })}
                        activeOpacity={0.7}
                      >
                        <Text style={s.editBtnText}>Edit</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            }}
          />
        )}
      </View>

      {/* Adjust Modal */}
      <Modal
        visible={!!adjustTarget}
        transparent
        animationType="fade"
        onRequestClose={closeAdjust}
      >
        <View style={m.overlay}>
          <KeyboardAvoidingView
            style={m.sheet}
            behavior={Platform.OS === 'android' ? 'height' : 'padding'}
          >
            {/* Fixed header */}
            <View style={m.modalHeader}>
              <View style={m.modalHeaderTop}>
                <Text style={m.title}>Adjust Stock</Text>
                <TouchableOpacity onPress={closeAdjust} hitSlop={12} activeOpacity={0.7}>
                  <Text style={m.closeX}>✕</Text>
                </TouchableOpacity>
              </View>
              {adjustTarget && (
                <View style={m.itemBox}>
                  <Text style={m.itemName}>{adjustTarget.name}</Text>
                  <Text style={m.itemCurrent}>
                    Current: {adjustTarget.quantity_on_hand % 1 === 0
                      ? adjustTarget.quantity_on_hand.toString()
                      : adjustTarget.quantity_on_hand.toFixed(2)} {adjustTarget.unit}
                  </Text>
                </View>
              )}
            </View>

            {/* Scrollable content */}
            <ScrollView
              style={m.scroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={m.scrollContent}
            >
              <Text style={m.label}>Quantity Change</Text>
              <Text style={m.hint}>Positive to add · Negative to subtract</Text>
              <TextInput
                style={m.input}
                placeholder="e.g. 50 or -10"
                placeholderTextColor={Colors.gray400}
                keyboardType="numeric"
                value={adjustDelta}
                onChangeText={(t) => { setAdjustDelta(t); setAdjustError(''); }}
              />

              <Text style={m.label}>Reason</Text>
              <View style={m.reasons}>
                {REASONS.map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[m.reasonBtn, adjustReason === r && m.reasonBtnSel]}
                    onPress={() => setAdjustReason(r)}
                    activeOpacity={0.7}
                  >
                    <View style={[m.reasonDot, adjustReason === r && m.reasonDotSel]} />
                    <Text style={[m.reasonText, adjustReason === r && m.reasonTextSel]}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={m.label}>Notes <Text style={m.optional}>(optional)</Text></Text>
              <TextInput
                style={[m.input, m.notesInput]}
                placeholder="e.g. Received from supplier"
                placeholderTextColor={Colors.gray400}
                multiline
                numberOfLines={2}
                value={adjustNotes}
                onChangeText={setAdjustNotes}
              />

            </ScrollView>

            {!!adjustError && (
              <View style={m.errorBanner}>
                <Text style={m.errorBannerText}>{adjustError}</Text>
              </View>
            )}

            {/* Fixed footer */}
            <View style={m.actions}>
              <TouchableOpacity style={m.cancelBtn} onPress={closeAdjust} disabled={adjusting}>
                <Text style={m.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[m.applyBtn, adjusting && m.applyBtnOff]}
                onPress={handleAdjust}
                disabled={adjusting}
                activeOpacity={0.8}
              >
                {adjusting
                  ? <ActivityIndicator color={Colors.white} size="small" />
                  : <Text style={m.applyText}>Apply</Text>
                }
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </AdminLayout>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:       { flex: 1, backgroundColor: Colors.background },
  header:     {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, paddingBottom: Spacing.md,
  },
  title:      { fontSize: FontSize.display, fontWeight: FontWeight.bold, color: Colors.gray900 },
  subtitle:   { fontSize: FontSize.sm, color: Colors.gray400, marginTop: 2 },
  addBtn:     {
    backgroundColor: Colors.green600, borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, ...Shadow.sm,
  },
  addBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.white },

  alertStrip: {
    marginHorizontal: Spacing.xl, marginBottom: Spacing.sm,
    backgroundColor: Colors.warningBg, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderWidth: 1, borderColor: Colors.warning + '55',
  },
  alertText:  { fontSize: FontSize.sm, color: Colors.warning, fontWeight: FontWeight.medium },

  filterRow:  {
    flexDirection: 'row', gap: Spacing.sm, alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md,
  },
  searchInput: {
    flex: 1, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    fontSize: FontSize.base, color: Colors.gray900,
  },
  statusTabs:    { flexDirection: 'row', gap: Spacing.xs },
  statusTab:     {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, backgroundColor: Colors.gray100,
  },
  statusTabSel:  { backgroundColor: Colors.green600 },
  statusTabText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.gray600 },
  statusTabTextSel: { color: Colors.white, fontWeight: FontWeight.bold },

  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorBox: {
    margin: Spacing.xl,
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.danger + '44',
    padding: Spacing.lg,
  },
  errorText: { color: Colors.danger, fontSize: FontSize.base },
  emptyText: {
    textAlign: 'center', color: Colors.gray400,
    fontSize: FontSize.base, paddingVertical: Spacing.xxxl,
  },
  listContent: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl, gap: Spacing.sm },

  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  cardInactive: { opacity: 0.6 },
  cardMain: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: Spacing.lg, gap: Spacing.md,
  },
  cardInfo:    { flex: 1, gap: 3 },
  nameRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  itemName:    { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.gray900 },
  inactiveBadge: {
    paddingHorizontal: Spacing.sm, paddingVertical: 1,
    borderRadius: Radius.full, backgroundColor: Colors.gray100,
    borderWidth: 1, borderColor: Colors.gray300,
  },
  inactiveBadgeText: { fontSize: FontSize.xs, color: Colors.gray500, fontWeight: FontWeight.medium },
  qtyRow:      { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  qty:         { fontSize: FontSize.xl, fontWeight: FontWeight.extrabold, color: Colors.gray800 },
  unit:        { fontSize: FontSize.base, fontWeight: FontWeight.normal, color: Colors.gray500 },
  reorderHint: { fontSize: FontSize.xs, color: Colors.gray400 },
  costHint:    { fontSize: FontSize.xs, color: Colors.gray400 },
  cardRight:   { alignItems: 'flex-end' },
  statusBadge: {
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
    borderRadius: Radius.sm, borderWidth: 1,
  },
  statusBadgeText: { fontSize: FontSize.xs, fontWeight: FontWeight.bold },

  cardActions: {
    flexDirection: 'row', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
  },
  adjustBtn: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, backgroundColor: Colors.green600,
  },
  adjustBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.white },
  editBtn: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  editBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.gray700 },
});

const m = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', alignItems: 'center', padding: Spacing.lg,
  },
  sheet: {
    width: '100%', maxWidth: 420, maxHeight: '88%',
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    overflow: 'hidden', ...Shadow.lg,
  },
  modalHeader: {
    padding: Spacing.xl, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderColor: Colors.border, gap: Spacing.sm,
  },
  modalHeaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  closeX: {
    fontSize: FontSize.xl,
    color: Colors.gray500,
    fontWeight: FontWeight.bold,
  },
  scroll: { flex: 1 },
  scrollContent: { gap: Spacing.md, padding: Spacing.xl, paddingTop: Spacing.md },
  title:    { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.gray900 },
  itemBox:  {
    backgroundColor: Colors.green50, borderRadius: Radius.md,
    padding: Spacing.md, gap: 2,
  },
  itemName:    { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.green700 },
  itemCurrent: { fontSize: FontSize.sm, color: Colors.green600 },

  label:    { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },
  hint:     { fontSize: FontSize.xs, color: Colors.gray400, marginTop: -Spacing.sm },
  optional: { fontWeight: FontWeight.normal, color: Colors.gray400 },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.gray900,
    backgroundColor: Colors.gray50,
  },
  notesInput: { fontSize: FontSize.base, fontWeight: FontWeight.normal, minHeight: 60, textAlignVertical: 'top' },

  reasons:       { gap: Spacing.xs },
  reasonBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  reasonBtnSel:  { borderColor: Colors.green600, backgroundColor: Colors.green50 },
  reasonDot: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: Colors.gray300,
  },
  reasonDotSel:  { borderColor: Colors.green600, backgroundColor: Colors.green600 },
  reasonText:    { fontSize: FontSize.sm, color: Colors.gray700 },
  reasonTextSel: { color: Colors.green700, fontWeight: FontWeight.semibold },

  errorBanner: {
    backgroundColor: Colors.dangerBg,
    borderTopWidth: 1,
    borderColor: Colors.danger + '44',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  errorBannerText: {
    fontSize: FontSize.sm,
    color: Colors.danger,
    fontWeight: FontWeight.medium,
  },
  actions: {
    flexDirection: 'row', gap: Spacing.sm,
    padding: Spacing.xl, paddingTop: Spacing.md,
    borderTopWidth: 1, borderColor: Colors.border,
  },
  cancelBtn: {
    flex: 1, paddingVertical: Spacing.md, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center',
  },
  cancelText:  { fontSize: FontSize.base, color: Colors.gray600, fontWeight: FontWeight.medium },
  applyBtn: {
    flex: 1, paddingVertical: Spacing.md, borderRadius: Radius.md,
    backgroundColor: Colors.green600, alignItems: 'center',
  },
  applyBtnOff: { backgroundColor: Colors.gray300 },
  applyText:   { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.white },
});
