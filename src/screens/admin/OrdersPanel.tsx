import React, { MutableRefObject, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Modal, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppModal, useToast } from '../../components/ui';
import {
  getOrdersPage, getOrdersSummary, getSettings, voidOrder,
  OrderFilters, OrdersPage, OrdersSummary,
} from '../../firebase/firestoreService';
import { buildReceipt } from '../../utils/printerTemplates';
import { printBytes } from '../../services/printerService';
import { useAuthStore } from '../../store/authStore';
import { useSyncEvents } from '../../context/SyncContext';
import { Order, OrderType, PaymentMethod, Settings } from '../../types';
import { exportCsv } from '../../utils/csvExport';
import { AdminStackParamList } from '../../navigation/AdminStack';
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
  pay_later: 'Pay Later',
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

// ─── Panel ────────────────────────────────────────────────────────────────────

type Nav = NativeStackNavigationProp<AdminStackParamList>;

export default function OrdersPanel({ exportRef }: { exportRef?: MutableRefObject<(() => void) | null> }) {
  const navigation  = useNavigation<Nav>();
  const { width: winW } = useWindowDimensions();
  const sidebarW = winW < 960 ? 56 : Math.max(160, Math.round(winW * 0.2));

  const currentUser = useAuthStore((s) => s.user)!;
  const canVoid     = currentUser.role === 'admin' || currentUser.role === 'manager';
  const isAdmin     = currentUser.role === 'admin';
  const toast       = useToast();

  const PAGE_SIZE = 50;

  const [period,        setPeriod]        = useState<Period>('today');
  const [orders,        setOrders]        = useState<Order[]>([]);
  const [summary,       setSummary]       = useState<OrdersSummary | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [loadingMore,   setLoadingMore]   = useState(false);
  const [hasMore,       setHasMore]       = useState(false);
  const [error,         setError]         = useState('');
  const [expanded,      setExpanded]      = useState<string | null>(null);
  const [voiding,       setVoiding]       = useState<string | null>(null);
  const [voidTarget,    setVoidTarget]    = useState<Order | null>(null);
  const [payFilter,     setPayFilter]     = useState<PaymentMethod | 'all'>('all');
  const [typeFilter,    setTypeFilter]    = useState<OrderType | 'all'>('all');
  const [openDropdown,  setOpenDropdown]  = useState<'pay' | 'type' | null>(null);
  const [search,        setSearch]        = useState('');
  const [syncVersion,   setSyncVersion]   = useState(0);
  const [settings,      setSettings]      = useState<Settings>({});
  const [reprinting,    setReprinting]    = useState<string | null>(null);

  const cursorRef = useRef<OrdersPage['cursor']>(null);

  const { subscribe } = useSyncEvents();
  useEffect(() => { return subscribe(() => setSyncVersion((v) => v + 1)); }, []);
  useEffect(() => { getSettings().then(setSettings).catch(() => {}); }, []);

  useEffect(() => { load(); }, [period, payFilter, typeFilter, syncVersion]);

  function buildFilters(): OrderFilters {
    return {
      payment_method: payFilter  !== 'all' ? payFilter  : undefined,
      order_type:     typeFilter !== 'all' ? typeFilter : undefined,
    };
  }

  async function load() {
    setLoading(true);
    setError('');
    setExpanded(null);
    setSummary(null);
    const { start, end } = getRange(period);
    const filters = buildFilters();

    getOrdersSummary(start, end, filters).then(setSummary).catch(() => {});

    try {
      const page = await getOrdersPage(start, end, filters, PAGE_SIZE, null);
      setOrders(page.orders);
      cursorRef.current = page.cursor;
      setHasMore(page.hasMore);
    } catch {
      setError('Failed to load orders.');
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const { start, end } = getRange(period);
    try {
      const page = await getOrdersPage(start, end, buildFilters(), PAGE_SIZE, cursorRef.current);
      setOrders((prev) => [...prev, ...page.orders]);
      cursorRef.current = page.cursor;
      setHasMore(page.hasMore);
    } catch {
      // Keep the pages we already have; the Load more button stays available.
    } finally {
      setLoadingMore(false);
    }
  }

  function confirmVoid(order: Order) { setVoidTarget(order); }

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
      const { start, end } = getRange(period);
      getOrdersSummary(start, end, buildFilters()).then(setSummary).catch(() => {});
      toast.success('Order voided');
    } catch {
      toast.error('Failed to void order. Check your connection.');
    } finally {
      setVoiding(null);
    }
  }

  async function handleReprint(order: Order) {
    setReprinting(order.id);
    try {
      const bytes = buildReceipt(order, 0, settings);
      await printBytes(bytes, {
        type:     (settings.receipt_printer_type ?? 'wifi') as 'wifi' | 'bluetooth',
        ip:       settings.receipt_printer_ip,
        port:     settings.receipt_printer_port,
        btDevice: settings.receipt_printer_bt,
      });
      toast.success('Receipt sent to printer');
    } catch (e: unknown) {
      toast.error((e as Error).message ?? 'Could not reach printer.');
    } finally {
      setReprinting(null);
    }
  }

  const q = search.trim().toLowerCase();
  const visibleOrders = q
    ? orders.filter((o) => o.order_number.toLowerCase().includes(q))
    : orders;

  async function handleExport() {
    try {
      const { start, end } = getRange(period);
      const filters = buildFilters();
      const all: Order[] = [];
      let cursor: OrdersPage['cursor'] = null;
      for (let i = 0; i < 200; i++) {
        const page = await getOrdersPage(start, end, filters, 200, cursor);
        all.push(...page.orders);
        if (!page.hasMore) break;
        cursor = page.cursor;
      }
      const rows = q ? all.filter((o) => o.order_number.toLowerCase().includes(q)) : all;
      if (!rows.length) { toast.info('No orders to export for this filter.'); return; }
      await exportCsv(...buildOrdersCsv(rows, isAdmin));
    } catch {
      toast.error('Could not export CSV. Check storage permissions.');
    }
  }

  if (exportRef) exportRef.current = handleExport;
  useEffect(() => () => { if (exportRef) exportRef.current = null; }, [exportRef]);

  // suppress unused warning — navigation is available for future drill-down
  void navigation;

  return (
    <View style={s.root}>
      {/* Period tabs */}
      <View style={s.header}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.periodScroll}
          contentContainerStyle={s.periodTabsContent}
        >
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
        </ScrollView>
      </View>

      {/* Filter row */}
      <View style={s.filterRow}>
        <TouchableOpacity
          style={[s.dropdownBtn, payFilter !== 'all' && s.dropdownBtnSel]}
          onPress={() => setOpenDropdown(openDropdown === 'pay' ? null : 'pay')}
          activeOpacity={0.8}
        >
          <Text style={s.dropdownCategory}>Pay</Text>
          <Text style={[s.dropdownLabel, payFilter !== 'all' && s.dropdownLabelSel]} numberOfLines={1}>
            {payFilter === 'all' ? 'All' : PAY_LABELS[payFilter as PaymentMethod]}
          </Text>
          <Text style={s.dropdownChevron}>{openDropdown === 'pay' ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        <View style={s.filterRowDivider} />

        <TouchableOpacity
          style={[s.dropdownBtn, typeFilter !== 'all' && s.dropdownBtnSel]}
          onPress={() => setOpenDropdown(openDropdown === 'type' ? null : 'type')}
          activeOpacity={0.8}
        >
          <Text style={s.dropdownCategory}>Type</Text>
          <Text style={[s.dropdownLabel, typeFilter !== 'all' && s.dropdownLabelSel]} numberOfLines={1}>
            {typeFilter === 'all' ? 'All' : TYPE_LABELS[typeFilter]}
          </Text>
          <Text style={s.dropdownChevron}>{openDropdown === 'type' ? '▲' : '▼'}</Text>
        </TouchableOpacity>
      </View>

      {/* Dropdown option list */}
      {openDropdown !== null && (
        <Modal
          transparent
          animationType="fade"
          visible
          onRequestClose={() => setOpenDropdown(null)}
        >
          <TouchableOpacity
            style={[s.dropdownOverlay, { paddingLeft: sidebarW + Spacing.md }]}
            activeOpacity={1}
            onPress={() => setOpenDropdown(null)}
          >
            <View style={s.dropdownCard}>
              {openDropdown === 'pay'
                ? (['all', 'cash', 'card', 'qr', 'gift_card', 'pay_later'] as const).map((m) => (
                  <TouchableOpacity
                    key={m}
                    style={[s.dropdownItem, payFilter === m && s.dropdownItemSel]}
                    onPress={() => { setPayFilter(m); setExpanded(null); setOpenDropdown(null); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.dropdownItemText, payFilter === m && s.dropdownItemTextSel]}>
                      {m === 'all' ? 'All' : PAY_LABELS[m as PaymentMethod]}
                    </Text>
                    {payFilter === m && <Text style={s.dropdownItemCheck}>✓</Text>}
                  </TouchableOpacity>
                ))
                : (['all', 'dine_in', 'takeaway', 'delivery'] as const).map((tp) => (
                  <TouchableOpacity
                    key={tp}
                    style={[s.dropdownItem, typeFilter === tp && s.dropdownItemSel]}
                    onPress={() => { setTypeFilter(tp); setExpanded(null); setOpenDropdown(null); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.dropdownItemText, typeFilter === tp && s.dropdownItemTextSel]}>
                      {tp === 'all' ? 'All' : TYPE_LABELS[tp]}
                    </Text>
                    {typeFilter === tp && <Text style={s.dropdownItemCheck}>✓</Text>}
                  </TouchableOpacity>
                ))
              }
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Search */}
      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          value={search}
          onChangeText={(text) => { setSearch(text); setExpanded(null); }}
          placeholder="Search order number…"
          placeholderTextColor={Colors.gray400}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {/* Summary bar */}
      {!loading && !error && summary && (
        <View style={s.summaryBar}>
          <Text style={s.summaryText}>
            {summary.activeCount} order{summary.activeCount !== 1 ? 's' : ''}
            {summary.voidedCount > 0 ? ` · ${summary.voidedCount} voided` : ''}
          </Text>
          <View style={s.summaryRight}>
            <Text style={s.summaryRevenue}>
              ₱{summary.revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })} revenue
            </Text>
            {isAdmin && (
              <Text style={s.summaryProfit}>
                ₱{summary.profit.toLocaleString('en-PH', { minimumFractionDigits: 2 })} profit
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
        <View style={s.errorBox}>
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={visibleOrders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={s.listContent}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (!search.trim()) loadMore(); }}
          ListEmptyComponent={
            <Text style={s.emptyText}>No orders for this period.</Text>
          }
          ListFooterComponent={
            hasMore ? (
              <TouchableOpacity
                style={s.loadMoreBtn}
                onPress={loadMore}
                disabled={loadingMore}
                activeOpacity={0.7}
              >
                {loadingMore
                  ? <ActivityIndicator size="small" color={Colors.green700} />
                  : <Text style={s.loadMoreText}>Load more</Text>
                }
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item: order }) => {
            const isOpen    = expanded === order.id;
            const isVoided  = order.status === 'cancelled';
            const isVoiding = voiding === order.id;

            return (
              <TouchableOpacity
                style={[s.orderCard, isVoided && s.orderCardVoided]}
                onPress={() => setExpanded(isOpen ? null : order.id)}
                activeOpacity={0.85}
              >
                <View style={s.orderRow}>
                  <View style={s.orderLeft}>
                    <View style={s.orderNumRow}>
                      <Text style={[s.orderNum, isVoided && s.orderNumVoided]} numberOfLines={1}>
                        #{order.order_number}
                      </Text>
                      {isVoided && (
                        <View style={s.voidedBadge}>
                          <Text style={s.voidedBadgeText} numberOfLines={1}>Voided</Text>
                        </View>
                      )}
                    </View>
                    <Text style={s.orderMeta} numberOfLines={2}>
                      {fmtDateTime(order.created_at)}
                      {' · '}{TYPE_LABELS[order.order_type] ?? order.order_type}
                      {order.table_number ? ` · ${order.table_number}` : ''}
                      {order.cashier_name ? ` · ${order.cashier_name}` : ''}
                    </Text>
                  </View>
                  <View style={s.orderRight}>
                    <Text style={[s.orderTotal, isVoided && s.orderTotalVoided]} numberOfLines={1} adjustsFontSizeToFit>
                      ₱{order.total_amount.toFixed(2)}
                    </Text>
                    <View style={s.payBadge}>
                      <Text style={s.payBadgeText} numberOfLines={1}>
                        {PAY_LABELS[order.payment_method] ?? order.payment_method}
                      </Text>
                    </View>
                  </View>
                  <Text style={s.chevron}>{isOpen ? '▲' : '▼'}</Text>
                </View>

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

                    <View style={s.actionRow}>
                      <TouchableOpacity
                        style={[s.reprintBtn, (!!reprinting) && s.reprintBtnOff]}
                        onPress={() => handleReprint(order)}
                        disabled={!!reprinting}
                        activeOpacity={0.7}
                      >
                        {reprinting === order.id
                          ? <ActivityIndicator size="small" color={Colors.green700} />
                          : <Text style={s.reprintBtnText}>Reprint</Text>
                        }
                      </TouchableOpacity>
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
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}

      {voidTarget && (
        <AppModal
          visible
          variant="confirm"
          danger
          title="Void Order"
          body={`Void order #${voidTarget.order_number}? This cannot be undone.`}
          confirmText="Void Order"
          onCancel={() => setVoidTarget(null)}
          onConfirm={() => {
            const id = voidTarget.id;
            setVoidTarget(null);
            doVoid(id);
          }}
        />
      )}
    </View>
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
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
  },
  periodScroll: { flex: 1 },
  periodTabsContent: { flexDirection: 'row', gap: Spacing.xs, alignItems: 'center' },
  periodTab: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.gray100,
  },
  periodTabSel: { backgroundColor: Colors.green600 },
  periodTabText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.gray600,
  },
  periodTabTextSel: {
    color: Colors.white,
    fontWeight: FontWeight.bold,
  },

  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  filterRowDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: Colors.border,
  },
  dropdownBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  dropdownBtnSel: {
    backgroundColor: Colors.green50,
  },
  dropdownCategory: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.gray400,
  },
  dropdownLabel: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.gray700,
  },
  dropdownLabelSel: {
    color: Colors.green700,
  },
  dropdownChevron: {
    fontSize: FontSize.xs,
    color: Colors.gray400,
  },
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'flex-start',
    paddingTop: 120,
    paddingRight: Spacing.xl,
  },
  dropdownCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadow.md,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  dropdownItemSel: {
    backgroundColor: Colors.green50,
  },
  dropdownItemText: {
    flex: 1,
    fontSize: FontSize.base,
    color: Colors.gray700,
    fontWeight: FontWeight.medium,
  },
  dropdownItemTextSel: {
    color: Colors.green700,
    fontWeight: FontWeight.bold,
  },
  dropdownItemCheck: {
    fontSize: FontSize.sm,
    color: Colors.green600,
    fontWeight: FontWeight.bold,
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
    flexWrap: 'wrap',
    gap: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'flex-end',
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
    textAlign: 'center',
    color: Colors.gray400,
    fontSize: FontSize.base,
    paddingVertical: Spacing.xxxl,
  },

  listContent: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },

  loadMoreBtn: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  loadMoreText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.green700,
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
    flexWrap: 'wrap',
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
    maxWidth: '42%',
    flexShrink: 0,
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
    maxWidth: '100%',
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

  actionRow: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  reprintBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.green600,
    alignItems: 'center',
    minWidth: 88,
    minHeight: 36,
    justifyContent: 'center',
  },
  reprintBtnOff: {
    borderColor: Colors.gray300,
    opacity: 0.5,
  },
  reprintBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.green700,
  },
  voidBtn: {
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
