import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import AdminLayout from './AdminLayout';
import { getOrdersInRange, voidOrder } from '../../firebase/firestoreService';
import { useAuthStore } from '../../store/authStore';
import { Order, OrderType, PaymentMethod } from '../../types';
import { exportCsv } from '../../utils/csvExport';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

// ─── Periods ──────────────────────────────────────────────────────────────────

type Period = 'today' | 'yesterday' | 'week' | 'month';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today',     label: 'Today'      },
  { value: 'yesterday', label: 'Yesterday'  },
  { value: 'week',      label: 'This Week'  },
  { value: 'month',     label: 'This Month' },
];

function getRange(period: Period): { start: string; end: string } {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'today':
      return {
        start: today.toISOString(),
        end:   new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString(),
      };
    case 'yesterday': {
      const d = new Date(today); d.setDate(d.getDate() - 1);
      return {
        start: d.toISOString(),
        end:   new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString(),
      };
    }
    case 'week': {
      const start = new Date(today); start.setDate(start.getDate() - 6);
      return { start: start.toISOString(), end: now.toISOString() };
    }
    case 'month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: start.toISOString(), end: now.toISOString() };
    }
  }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const PAY_LABELS: Record<PaymentMethod, string> = {
  cash:      'Cash',
  card:      'Card',
  qr:        'QR',
  gift_card: 'Gift',
};

const TYPE_LABELS: Record<string, string> = {
  dine_in:  'Dine In',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function buildOrdersCsv(orders: Order[], includeProfit: boolean): Parameters<typeof exportCsv> {
  const headers = ['Order #', 'Date', 'Cashier', 'Type', 'Payment', 'Total', ...(includeProfit ? ['Profit'] : []), 'Status'];
  const rows = orders.map((o) => [
    o.order_number,
    new Date(o.created_at).toLocaleString('en-PH'),
    o.cashier_name ?? '',
    TYPE_LABELS[o.order_type] ?? o.order_type,
    PAY_LABELS[o.payment_method] ?? o.payment_method,
    o.total_amount.toFixed(2),
    ...(includeProfit ? [(o.profit_amount ?? 0).toFixed(2)] : []),
    o.status === 'cancelled' ? 'Voided' : 'Active',
  ]);
  const date = new Date().toISOString().slice(0, 10);
  return [`orders_${date}.csv`, headers, rows];
}

// ─── Order History ────────────────────────────────────────────────────────────

export default function OrderHistoryScreen() {
  const currentUser = useAuthStore((s) => s.user)!;
  const canVoid     = currentUser.role === 'admin';
  const isAdmin     = currentUser.role === 'admin';

  const [period,     setPeriod]     = useState<Period>('today');
  const [orders,     setOrders]     = useState<Order[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [expanded,   setExpanded]   = useState<string | null>(null);
  const [voiding,    setVoiding]    = useState<string | null>(null);
  const [payFilter,  setPayFilter]  = useState<PaymentMethod | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<OrderType | 'all'>('all');
  const [search,     setSearch]     = useState('');
  const [exporting,  setExporting]  = useState(false);

  useEffect(() => { loadOrders(); }, [period]);

  async function loadOrders() {
    setLoading(true);
    setError('');
    setExpanded(null);
    try {
      const { start, end } = getRange(period);
      setOrders(await getOrdersInRange(start, end));
    } catch {
      setError('Failed to load orders.');
    } finally {
      setLoading(false);
    }
  }

  function confirmVoid(order: Order) {
    Alert.alert(
      'Void Order',
      `Void order #${order.order_number}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Void Order',
          style: 'destructive',
          onPress: () => doVoid(order.id),
        },
      ],
    );
  }

  async function doVoid(orderId: string) {
    setVoiding(orderId);
    try {
      await voidOrder(orderId);
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? { ...o, status: 'cancelled', payment_status: 'unpaid' }
            : o,
        ),
      );
    } catch {
      Alert.alert('Error', 'Failed to void order. Check your connection.');
    } finally {
      setVoiding(null);
    }
  }

  const filteredOrders = orders.filter((o) => {
    if (payFilter  !== 'all' && o.payment_method !== payFilter)  return false;
    if (typeFilter !== 'all' && o.order_type     !== typeFilter) return false;
    const q = search.trim().toLowerCase();
    if (q && !o.order_number.toLowerCase().includes(q)) return false;
    return true;
  });
  const activeOrders  = filteredOrders.filter((o) => o.status !== 'cancelled');
  const revenue       = activeOrders.reduce((s, o) => s + o.total_amount, 0);
  const profit        = activeOrders.reduce((s, o) => s + (o.profit_amount ?? 0), 0);
  const voidedCount   = filteredOrders.length - activeOrders.length;

  async function handleExport() {
    if (!filteredOrders.length) return;
    setExporting(true);
    try {
      await exportCsv(...buildOrdersCsv(filteredOrders, isAdmin));
    } catch {
      Alert.alert('Export Failed', 'Could not export CSV. Check storage permissions.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <AdminLayout active="Orders">
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.titleRow}>
            <Text style={s.title}>Orders</Text>
            {!loading && filteredOrders.length > 0 && (
              <TouchableOpacity
                style={[s.exportBtn, exporting && s.exportBtnOff]}
                onPress={handleExport}
                disabled={exporting}
                activeOpacity={0.8}
              >
                <Text style={s.exportBtnText}>{exporting ? 'Exporting…' : '⬇ Export CSV'}</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={s.periodTabs}>
            {PERIODS.map((p) => (
              <TouchableOpacity
                key={p.value}
                style={[s.periodTab, period === p.value && s.periodTabSel]}
                onPress={() => setPeriod(p.value)}
              >
                <Text style={[s.periodTabText, period === p.value && s.periodTabTextSel]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Payment filter chips */}
        <View style={s.payFilterRow}>
          {(['all', 'cash', 'card', 'qr', 'gift_card'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              style={[s.payChip, payFilter === m && s.payChipSel]}
              onPress={() => { setPayFilter(m); setExpanded(null); }}
              activeOpacity={0.7}
            >
              <Text style={[s.payChipText, payFilter === m && s.payChipTextSel]}>
                {m === 'all' ? 'All' : PAY_LABELS[m as PaymentMethod]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Order type filter chips */}
        <View style={s.typeFilterRow}>
          {(['all', 'dine_in', 'takeaway', 'delivery'] as const).map((t) => (
            <TouchableOpacity
              key={t}
              style={[s.payChip, typeFilter === t && s.payChipSel]}
              onPress={() => { setTypeFilter(t); setExpanded(null); }}
              activeOpacity={0.7}
            >
              <Text style={[s.payChipText, typeFilter === t && s.payChipTextSel]}>
                {t === 'all' ? 'All Types' : TYPE_LABELS[t]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Search by order number */}
        <View style={s.searchRow}>
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={(t) => { setSearch(t); setExpanded(null); }}
            placeholder="Search order number…"
            placeholderTextColor={Colors.gray400}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        {/* Summary bar */}
        {!loading && !error && (
          <View style={s.summaryBar}>
            <Text style={s.summaryText}>
              {activeOrders.length} order{activeOrders.length !== 1 ? 's' : ''}
              {voidedCount > 0 ? ` · ${voidedCount} voided` : ''}
            </Text>
            <View style={s.summaryRight}>
              <Text style={s.summaryRevenue}>
                ₱{revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })} revenue
              </Text>
              {isAdmin && (
                <Text style={s.summaryProfit}>
                  ₱{profit.toLocaleString('en-PH', { minimumFractionDigits: 2 })} profit
                </Text>
              )}
            </View>
          </View>
        )}

        {/* List */}
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={Colors.green600} />
          </View>
        ) : error ? (
          <View style={s.center}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : (
          <FlatList
            data={filteredOrders}
            keyExtractor={(o) => o.id}
            contentContainerStyle={s.listContent}
            ListEmptyComponent={
              <Text style={s.emptyText}>No orders for this period.</Text>
            }
            renderItem={({ item: order }) => {
              const isOpen      = expanded === order.id;
              const isVoided    = order.status === 'cancelled';
              const isVoiding   = voiding === order.id;

              return (
                <TouchableOpacity
                  style={[s.orderCard, isVoided && s.orderCardVoided]}
                  onPress={() => setExpanded(isOpen ? null : order.id)}
                  activeOpacity={0.85}
                >
                  {/* Row summary */}
                  <View style={s.orderRow}>
                    <View style={s.orderLeft}>
                      <View style={s.orderNumRow}>
                        <Text style={[s.orderNum, isVoided && s.orderNumVoided]}>
                          #{order.order_number}
                        </Text>
                        {isVoided && (
                          <View style={s.voidedBadge}>
                            <Text style={s.voidedBadgeText}>Voided</Text>
                          </View>
                        )}
                      </View>
                      <Text style={s.orderMeta}>
                        {fmtDateTime(order.created_at)}
                        {' · '}{TYPE_LABELS[order.order_type] ?? order.order_type}
                        {order.table_number ? ` · ${order.table_number}` : ''}
                        {order.cashier_name ? ` · ${order.cashier_name}` : ''}
                      </Text>
                    </View>
                    <View style={s.orderRight}>
                      <Text style={[s.orderTotal, isVoided && s.orderTotalVoided]}>
                        ₱{order.total_amount.toFixed(2)}
                      </Text>
                      <View style={s.payBadge}>
                        <Text style={s.payBadgeText}>
                          {PAY_LABELS[order.payment_method] ?? order.payment_method}
                        </Text>
                      </View>
                    </View>
                    <Text style={s.chevron}>{isOpen ? '▲' : '▼'}</Text>
                  </View>

                  {/* Expanded items */}
                  {isOpen && (
                    <View style={s.itemsSection}>
                      <View style={s.itemsDivider} />
                      {order.items.map((item, idx) => (
                        <View key={idx} style={s.itemRow}>
                          <Text style={s.itemName}>
                            {item.product_name}
                            {item.modifiers.length > 0
                              ? ` (${item.modifiers.map((m) => m.modifier_name).join(', ')})`
                              : ''}
                          </Text>
                          <Text style={s.itemQty}>×{item.quantity}</Text>
                          <Text style={s.itemPrice}>₱{item.subtotal.toFixed(2)}</Text>
                        </View>
                      ))}
                      {order.discount_amount > 0 && (
                        <View style={[s.itemRow, s.discountRow]}>
                          <Text style={s.discountText}>Discount</Text>
                          <Text style={s.discountAmount}>−₱{order.discount_amount.toFixed(2)}</Text>
                        </View>
                      )}

                      {/* Void action */}
                      {canVoid && !isVoided && (
                        <TouchableOpacity
                          style={[s.voidBtn, isVoiding && s.voidBtnDisabled]}
                          onPress={() => confirmVoid(order)}
                          disabled={isVoiding}
                          activeOpacity={0.7}
                        >
                          {isVoiding
                            ? <ActivityIndicator size="small" color={Colors.danger} />
                            : <Text style={s.voidBtnText}>Void Order</Text>
                          }
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    </AdminLayout>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.lg,
    flexWrap: 'wrap',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.gray900,
  },
  exportBtn: {
    borderWidth: 1.5,
    borderColor: Colors.green600,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  exportBtnOff: { opacity: 0.5 },
  exportBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.green700,
  },
  periodTabs: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  periodTab: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.gray100,
  },
  periodTabSel: {
    backgroundColor: Colors.green600,
  },
  periodTabText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.gray600,
  },
  periodTabTextSel: {
    color: Colors.white,
    fontWeight: FontWeight.bold,
  },

  payFilterRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    flexWrap: 'wrap',
  },
  typeFilterRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    flexWrap: 'wrap',
  },
  searchRow: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.sm,
    color: Colors.gray800,
    backgroundColor: Colors.white,
  },
  payChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.gray100,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  payChipSel: {
    backgroundColor: Colors.green50,
    borderColor: Colors.green600,
  },
  payChipText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.gray600,
  },
  payChipTextSel: {
    color: Colors.green700,
    fontWeight: FontWeight.bold,
  },

  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.green50,
    borderBottomWidth: 1,
    borderColor: Colors.green100,
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  summaryText: {
    fontSize: FontSize.sm,
    color: Colors.green700,
    fontWeight: FontWeight.medium,
  },
  summaryRight: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'center',
  },
  summaryRevenue: {
    fontSize: FontSize.sm,
    color: Colors.green700,
    fontWeight: FontWeight.bold,
  },
  summaryProfit: {
    fontSize: FontSize.sm,
    color: Colors.info,
    fontWeight: FontWeight.bold,
  },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: { color: Colors.danger, fontSize: FontSize.base },
  emptyText: {
    textAlign: 'center',
    color: Colors.gray400,
    fontSize: FontSize.base,
    paddingVertical: Spacing.xxxl,
  },

  listContent: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },

  orderCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  orderCardVoided: {
    opacity: 0.6,
    borderColor: Colors.gray200,
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  orderLeft:  { flex: 1 },
  orderNumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  orderNum: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.gray800,
  },
  orderNumVoided: {
    color: Colors.gray400,
    textDecorationLine: 'line-through',
  },
  voidedBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
    backgroundColor: Colors.dangerBg,
    borderWidth: 1,
    borderColor: Colors.danger + '44',
  },
  voidedBadgeText: {
    fontSize: FontSize.xs,
    color: Colors.danger,
    fontWeight: FontWeight.bold,
  },
  orderMeta: {
    fontSize: FontSize.xs,
    color: Colors.gray500,
    marginTop: 2,
  },
  orderRight: {
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  orderTotal: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.extrabold,
    color: Colors.green700,
  },
  orderTotalVoided: {
    color: Colors.gray400,
    textDecorationLine: 'line-through',
  },
  payBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
    backgroundColor: Colors.gray100,
  },
  payBadgeText: {
    fontSize: FontSize.xs,
    color: Colors.gray600,
    fontWeight: FontWeight.medium,
  },
  chevron: {
    fontSize: FontSize.xs,
    color: Colors.gray400,
    marginLeft: Spacing.xs,
  },

  itemsSection: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  itemsDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginBottom: Spacing.sm,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 3,
  },
  itemName: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.gray700,
  },
  itemQty: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
    minWidth: 28,
    textAlign: 'center',
  },
  itemPrice: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.gray800,
    minWidth: 64,
    textAlign: 'right',
  },
  discountRow: {
    borderTopWidth: 1,
    borderColor: Colors.border,
    marginTop: Spacing.xs,
    paddingTop: Spacing.xs,
    justifyContent: 'space-between',
  },
  discountText: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.danger,
    fontWeight: FontWeight.medium,
  },
  discountAmount: {
    fontSize: FontSize.sm,
    color: Colors.danger,
    fontWeight: FontWeight.bold,
  },

  voidBtn: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.danger,
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  voidBtnDisabled: {
    borderColor: Colors.gray300,
  },
  voidBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.danger,
  },
});
