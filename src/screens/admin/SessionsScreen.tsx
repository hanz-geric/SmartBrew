import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Modal, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import AdminLayout from './AdminLayout';
import { getRecentSessions, getSessionsInRange, getOrdersBySession } from '../../firebase/firestoreService';
import { CashSession, Order, PaymentMethod } from '../../types';
import { exportCsv } from '../../utils/csvExport';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing, rs,
} from '../../constants/theme';

// ─── Period helpers ───────────────────────────────────────────────────────────

type SessionPeriod = 'today' | 'week' | 'month' | 'all';

const SESSION_PERIODS: { value: SessionPeriod; label: string }[] = [
  { value: 'today', label: 'Today'      },
  { value: 'week',  label: 'This Week'  },
  { value: 'month', label: 'This Month' },
  { value: 'all',   label: 'All'        },
];

function getSessionRange(period: SessionPeriod): { start: string; end: string } | null {
  if (period === 'all') return null;
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'today':
      return {
        start: today.toISOString(),
        end:   new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString(),
      };
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PH', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function duration(start: string, end: string | null): string {
  if (!end) return 'Open';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const h  = Math.floor(ms / 3_600_000);
  const m  = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const PAY_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash', card: 'Card', qr: 'QR', gift_card: 'Gift',
};

const TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine In', takeaway: 'Takeaway', delivery: 'Delivery',
};

// ─── Product Summary Types ────────────────────────────────────────────────────

interface ProductStat {
  name:       string;
  qty:        number;
  revenue:    number;
  orderCount: number;
}

function buildProductStats(orders: Order[]): ProductStat[] {
  const map: Record<string, ProductStat> = {};
  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    for (const item of (order.items ?? [])) {
      if (!map[item.product_name]) {
        map[item.product_name] = { name: item.product_name, qty: 0, revenue: 0, orderCount: 0 };
      }
      map[item.product_name].qty        += item.quantity;
      map[item.product_name].revenue    += item.subtotal;
      map[item.product_name].orderCount += 1;
    }
  }
  return Object.values(map).sort((a, b) => b.qty - a.qty);
}

// ─── Session Drill-Down Modal ─────────────────────────────────────────────────

type DrillTab = 'summary' | 'orders';

function SessionDrillModal({
  session,
  onClose,
}: {
  session: CashSession;
  onClose: () => void;
}) {
  const [tab,     setTab]     = useState<DrillTab>('summary');
  const [orders,  setOrders]  = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOrdersBySession(session.id)
      .then(setOrders)
      .finally(() => setLoading(false));
  }, [session.id]);

  const activeOrders  = orders.filter((o) => o.status !== 'cancelled');
  const voidedCount   = orders.length - activeOrders.length;
  const revenue       = activeOrders.reduce((s, o) => s + o.total_amount, 0);
  const cashCollected = activeOrders
    .filter((o) => o.payment_method === 'cash')
    .reduce((s, o) => s + o.total_amount, 0);

  const productStats = buildProductStats(orders);
  const statTotal    = productStats.reduce((s, p) => s + p.revenue, 0);

  // Detect cashier switches: unique cashier names across all orders
  const cashierNames = [...new Set(orders.map((o) => o.cashier_name).filter(Boolean))];
  const hadSwitches  = cashierNames.length > 1;

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View style={d.overlay}>
        <View style={d.sheet}>
          {/* Header */}
          <View style={d.header}>
            <View style={{ flex: 1 }}>
              <Text style={d.headerName}>{session.cashier_name}</Text>
              <Text style={d.headerDate}>{fmtDateTime(session.start_time)}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12} style={d.closeBtn}>
              <Text style={d.closeX}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Summary chips */}
          {!loading && (
            <View style={d.chips}>
              <Chip label={`${orders.length} orders`} />
              <Chip label={`₱${revenue.toFixed(2)} revenue`} green />
              <Chip label={`₱${cashCollected.toFixed(2)} cash`} />
              {voidedCount > 0 && <Chip label={`${voidedCount} voided`} danger />}
              {hadSwitches && <Chip label={`⇄ ${cashierNames.length} cashiers`} warning />}
            </View>
          )}

          {/* Tabs */}
          <View style={d.tabs}>
            <TouchableOpacity
              style={[d.tab, tab === 'summary' && d.tabSel]}
              onPress={() => setTab('summary')}
            >
              <Text style={[d.tabText, tab === 'summary' && d.tabTextSel]}>Product Summary</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[d.tab, tab === 'orders' && d.tabSel]}
              onPress={() => setTab('orders')}
            >
              <Text style={[d.tabText, tab === 'orders' && d.tabTextSel]}>Orders</Text>
            </TouchableOpacity>
          </View>

          {/* Content */}
          {loading ? (
            <View style={d.center}>
              <ActivityIndicator size="large" color={Colors.green600} />
            </View>
          ) : tab === 'summary' ? (
            <ScrollView style={d.tabContent}>
              {/* Column headers */}
              <View style={[d.tableRow, d.tableHeader]}>
                <Text style={[d.colProduct, d.colHead]}>Product</Text>
                <Text style={[d.colQty, d.colHead]}>Qty</Text>
                <Text style={[d.colOrders, d.colHead]}>Orders</Text>
                <Text style={[d.colRev, d.colHead]}>Revenue</Text>
              </View>
              {productStats.length === 0 ? (
                <Text style={d.empty}>No completed orders in this session.</Text>
              ) : (
                productStats.map((stat) => (
                  <View key={stat.name} style={d.tableRow}>
                    <Text style={d.colProduct} numberOfLines={1}>{stat.name}</Text>
                    <Text style={d.colQty}>{stat.qty}</Text>
                    <Text style={d.colOrders}>{stat.orderCount}</Text>
                    <Text style={d.colRev}>₱{stat.revenue.toFixed(2)}</Text>
                  </View>
                ))
              )}
              {productStats.length > 0 && (
                <View style={[d.tableRow, d.tableFooter]}>
                  <Text style={[d.colProduct, d.footerText]}>Total</Text>
                  <Text style={d.colQty} />
                  <Text style={d.colOrders} />
                  <Text style={[d.colRev, d.footerText]}>₱{statTotal.toFixed(2)}</Text>
                </View>
              )}
            </ScrollView>
          ) : (
            <ScrollView style={d.tabContent}>
              {orders.length === 0 ? (
                <Text style={d.empty}>No orders in this session.</Text>
              ) : (
                orders.map((order, idx) => {
                  const isVoided   = order.status === 'cancelled';
                  const prevOrder  = idx > 0 ? orders[idx - 1] : null;
                  const didSwitch  = hadSwitches && prevOrder && prevOrder.cashier_name !== order.cashier_name;
                  return (
                    <View key={order.id}>
                      {(idx === 0 && hadSwitches) && (
                        <View style={d.switchBanner}>
                          <Text style={d.switchBannerText}>⇄ {order.cashier_name}</Text>
                        </View>
                      )}
                      {didSwitch && (
                        <View style={d.switchBanner}>
                          <Text style={d.switchBannerText}>⇄ Switched to {order.cashier_name}</Text>
                        </View>
                      )}
                      <View style={[d.orderRow, isVoided && d.orderRowVoided]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[d.orderNum, isVoided && d.orderNumVoided]}>
                            #{order.order_number}
                          </Text>
                          <Text style={d.orderMeta}>
                            {fmtTime(order.created_at)}
                            {' · '}{TYPE_LABELS[order.order_type] ?? order.order_type}
                            {' · '}{PAY_LABELS[order.payment_method] ?? order.payment_method}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 4 }}>
                          <Text style={[d.orderTotal, isVoided && d.orderTotalVoided]}>
                            ₱{order.total_amount.toFixed(2)}
                          </Text>
                          {isVoided && (
                            <View style={d.voidedBadge}>
                              <Text style={d.voidedBadgeText}>Voided</Text>
                            </View>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Chip({ label, green, danger, warning }: { label: string; green?: boolean; danger?: boolean; warning?: boolean }) {
  const bg   = danger ? Colors.dangerBg  : green ? Colors.green50  : warning ? Colors.warningBg : Colors.gray100;
  const text = danger ? Colors.danger    : green ? Colors.green700 : warning ? Colors.warning   : Colors.gray600;
  return (
    <View style={[d.chip, { backgroundColor: bg }]}>
      <Text style={[d.chipText, { color: text }]}>{label}</Text>
    </View>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function buildSessionsCsv(sessions: CashSession[]): Parameters<typeof exportCsv> {
  const headers = ['Cashier', 'Opened', 'Closed', 'Starting Cash', 'Cash Collected', 'Expected', 'Actual', 'Difference', 'Status'];
  const rows = sessions.map((s) => [
    s.cashier_name,
    fmtDate(s.start_time),
    fmtDate(s.end_time),
    s.starting_cash.toFixed(2),
    (s.cash_collected ?? 0).toFixed(2),
    (s.expected_cash ?? '').toString(),
    (s.actual_cash ?? '').toString(),
    (s.difference ?? '').toString(),
    s.status === 'open' ? 'Open' : 'Closed',
  ]);
  const date = new Date().toISOString().slice(0, 10);
  return [`sessions_${date}.csv`, headers, rows];
}

// ─── Sessions Screen ──────────────────────────────────────────────────────────

export default function SessionsScreen() {
  const [sessions,     setSessions]     = useState<CashSession[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [drillSession, setDrillSession] = useState<CashSession | null>(null);
  const [period,       setPeriod]       = useState<SessionPeriod>('week');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [exporting,    setExporting]    = useState(false);

  useEffect(() => { load(); }, [period]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const range = getSessionRange(period);
      setSessions(range
        ? await getSessionsInRange(range.start, range.end)
        : await getRecentSessions(100),
      );
    } catch {
      setError('Failed to load sessions.');
    } finally {
      setLoading(false);
    }
  }

  const filteredSessions = statusFilter === 'all'
    ? sessions
    : sessions.filter((sess) => sess.status === statusFilter);

  const openCount    = filteredSessions.filter((s) => s.status === 'open').length;
  const closedCount  = filteredSessions.filter((s) => s.status === 'closed').length;
  const totalHandled = filteredSessions.reduce((s, sess) => s + (sess.cash_collected ?? 0), 0);
  const variance     = filteredSessions
    .filter((sess) => sess.difference !== null)
    .reduce((s, sess) => s + (sess.difference ?? 0), 0);

  async function handleExport() {
    if (!filteredSessions.length) return;
    setExporting(true);
    try {
      await exportCsv(...buildSessionsCsv(filteredSessions));
    } catch {
      // silently ignore share cancellation
    } finally {
      setExporting(false);
    }
  }

  return (
    <AdminLayout active="Sessions">
      <View style={s.root}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.titleRow}>
            <Text style={s.title}>Cash Sessions</Text>
            {!loading && filteredSessions.length > 0 && (
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
            {SESSION_PERIODS.map((p) => (
              <TouchableOpacity
                key={p.value}
                style={[s.periodTab, period === p.value && s.periodTabSel]}
                onPress={() => { setPeriod(p.value); setStatusFilter('all'); }}
              >
                <Text style={[s.periodTabText, period === p.value && s.periodTabTextSel]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={s.refreshBtn} onPress={load} disabled={loading}>
            <Text style={s.refreshText}>{loading ? '…' : '↻ Refresh'}</Text>
          </TouchableOpacity>
        </View>

        {/* Status filter chips */}
        <View style={s.statusFilterRow}>
          {(['all', 'open', 'closed'] as const).map((f) => (
            <TouchableOpacity
              key={f}
              style={[s.statusChip, statusFilter === f && s.statusChipSel]}
              onPress={() => setStatusFilter(f)}
              activeOpacity={0.7}
            >
              <Text style={[s.statusChipText, statusFilter === f && s.statusChipTextSel]}>
                {f === 'all' ? 'All' : f === 'open' ? 'Open' : 'Closed'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Summary */}
        {!loading && !error && filteredSessions.length > 0 && (
          <View style={s.summaryBar}>
            <View style={s.summaryLeft}>
              <Text style={s.summaryText}>
                {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''}
                {openCount > 0 ? ` · ${openCount} open` : ''}
                {closedCount > 0 ? ` · ${closedCount} closed` : ''}
              </Text>
            </View>
            <View style={s.summaryRight}>
              <Text style={s.summaryRevenue}>
                ₱{totalHandled.toLocaleString('en-PH', { minimumFractionDigits: 2 })} collected
              </Text>
              {variance !== 0 && (
                <Text style={[s.summaryVariance, variance > 0 ? s.varianceOver : s.varianceShort]}>
                  {variance > 0 ? '▲' : '▼'} ₱{Math.abs(variance).toFixed(2)}
                </Text>
              )}
            </View>
          </View>
        )}

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
            data={filteredSessions}
            keyExtractor={(s) => s.id}
            contentContainerStyle={s.listContent}
            ListEmptyComponent={<Text style={s.emptyText}>No sessions found.</Text>}
            renderItem={({ item: sess }) => {
              const diff    = sess.difference;
              const isOpen  = sess.status === 'open';
              const isOver  = diff !== null && diff > 0;
              const isShort = diff !== null && diff < 0;
              const isExact = diff !== null && diff === 0;

              return (
                <TouchableOpacity
                  style={[s.card, isOpen && s.cardOpen]}
                  onPress={() => setDrillSession(sess)}
                  activeOpacity={0.85}
                >
                  {/* Top row */}
                  <View style={s.cardTop}>
                    <View style={s.cardLeft}>
                      <Text style={s.cashier}>{sess.cashier_name}</Text>
                      <Text style={s.dateText}>
                        {fmtDateTime(sess.start_time)}
                        {sess.end_time
                          ? ` → ${fmtTime(sess.end_time)}  (${duration(sess.start_time, sess.end_time)})`
                          : ''}
                      </Text>
                    </View>
                    <View style={s.cardTopRight}>
                      <View style={[s.statusBadge, isOpen && s.statusOpen]}>
                        <Text style={[s.statusText, isOpen && s.statusOpenText]}>
                          {isOpen ? 'Open' : 'Closed'}
                        </Text>
                      </View>
                      <Text style={s.viewHint}>View ›</Text>
                    </View>
                  </View>

                  {/* Cash grid */}
                  <View style={s.cashGrid}>
                    <CashCell label="Starting"  value={`₱${sess.starting_cash.toFixed(2)}`} />
                    <CashCell label="Collected"  value={`₱${(sess.cash_collected ?? 0).toFixed(2)}`} />
                    <CashCell
                      label="Expected"
                      value={sess.expected_cash !== null ? `₱${sess.expected_cash.toFixed(2)}` : '—'}
                    />
                    <CashCell
                      label="Actual"
                      value={sess.actual_cash !== null ? `₱${sess.actual_cash.toFixed(2)}` : '—'}
                    />
                  </View>

                  {/* Difference */}
                  {diff !== null && (
                    <View style={[
                      s.diffRow,
                      isOver  && s.diffOver,
                      isShort && s.diffShort,
                      isExact && s.diffExact,
                    ]}>
                      <Text style={s.diffLabel}>
                        {isOver ? 'Over' : isShort ? 'Short' : 'Exact'}
                      </Text>
                      <Text style={s.diffValue}>
                        {isExact ? '₱0.00' : `${diff > 0 ? '+' : ''}₱${diff.toFixed(2)}`}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>

      {drillSession && (
        <SessionDrillModal
          session={drillSession}
          onClose={() => setDrillSession(null)}
        />
      )}
    </AdminLayout>
  );
}

function CashCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={cc.cell}>
      <Text style={cc.label}>{label}</Text>
      <Text style={cc.value}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderColor: Colors.border,
    gap: Spacing.md, flexWrap: 'wrap',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.gray900 },
  exportBtn: {
    borderWidth: 1.5, borderColor: Colors.green600,
    borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
  },
  exportBtnOff: { opacity: 0.5 },
  exportBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.green700 },
  periodTabs: { flex: 1, flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap' },
  periodTab: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, backgroundColor: Colors.gray100,
  },
  periodTabSel:     { backgroundColor: Colors.green600 },
  periodTabText:    { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.gray600 },
  periodTabTextSel: { color: Colors.white, fontWeight: FontWeight.bold },
  refreshBtn: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
  },
  refreshText: { fontSize: FontSize.sm, color: Colors.green700, fontWeight: FontWeight.semibold },

  statusFilterRow: {
    flexDirection: 'row', gap: Spacing.xs,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderColor: Colors.border,
  },
  statusChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: Radius.full, backgroundColor: Colors.gray100,
    borderWidth: 1, borderColor: 'transparent',
  },
  statusChipSel:     { backgroundColor: Colors.green50, borderColor: Colors.green600 },
  statusChipText:    { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.gray600 },
  statusChipTextSel: { color: Colors.green700, fontWeight: FontWeight.bold },

  summaryBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm,
    backgroundColor: Colors.green50, borderBottomWidth: 1, borderColor: Colors.green100,
    flexWrap: 'wrap', gap: Spacing.xs,
  },
  summaryLeft:     { flex: 1 },
  summaryRight:    { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  summaryText:     { fontSize: FontSize.sm, color: Colors.green700, fontWeight: FontWeight.medium },
  summaryRevenue:  { fontSize: FontSize.sm, color: Colors.green700, fontWeight: FontWeight.bold },
  summaryVariance: { fontSize: FontSize.sm, fontWeight: FontWeight.bold },
  varianceOver:    { color: Colors.info },
  varianceShort:   { color: Colors.danger },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: Colors.danger, fontSize: FontSize.base },
  emptyText: { textAlign: 'center', color: Colors.gray400, fontSize: FontSize.base, paddingVertical: Spacing.xxxl },
  listContent: { padding: Spacing.lg, gap: Spacing.md },

  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', ...Shadow.sm,
  },
  cardOpen:    { borderColor: Colors.green400 },
  cardTop:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: Spacing.lg },
  cardLeft:    { flex: 1 },
  cardTopRight: { alignItems: 'flex-end', gap: Spacing.xs },
  cashier:  { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.gray900 },
  dateText: { fontSize: FontSize.sm, color: Colors.gray500, marginTop: 2 },
  viewHint: { fontSize: FontSize.xs, color: Colors.green600, fontWeight: FontWeight.medium },
  statusBadge: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: Radius.full, backgroundColor: Colors.gray100,
  },
  statusOpen:     { backgroundColor: Colors.green100 },
  statusText:     { fontSize: FontSize.xs, fontWeight: FontWeight.bold, color: Colors.gray600 },
  statusOpenText: { color: Colors.green700 },

  cashGrid: { flexDirection: 'row', borderTopWidth: 1, borderColor: Colors.border },
  diffRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderTopWidth: 1, borderColor: Colors.border,
  },
  diffOver:  { backgroundColor: Colors.infoBg },
  diffShort: { backgroundColor: Colors.dangerBg },
  diffExact: { backgroundColor: Colors.green50 },
  diffLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },
  diffValue: { fontSize: FontSize.base, fontWeight: FontWeight.extrabold, color: Colors.gray900 },
});

const cc = StyleSheet.create({
  cell: {
    flex: 1, padding: Spacing.md, alignItems: 'center',
    borderRightWidth: 1, borderColor: Colors.border,
  },
  label: { fontSize: FontSize.xs, color: Colors.gray500, fontWeight: FontWeight.medium, marginBottom: 2 },
  value: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.gray800 },
});

const d = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center', padding: Spacing.xl,
  },
  sheet: {
    width: '100%', maxWidth: 560, maxHeight: '85%',
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    overflow: 'hidden', ...Shadow.lg,
  },
  header: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: Spacing.xl, gap: Spacing.md,
    backgroundColor: Colors.green700,
  },
  headerName: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.white },
  headerDate: { fontSize: FontSize.sm, color: Colors.green200, marginTop: 2 },
  closeBtn:   { padding: Spacing.xs },
  closeX:     { fontSize: FontSize.xl, color: Colors.white, fontWeight: FontWeight.bold },

  chips: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderColor: Colors.border,
  },
  chip:     { paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: Radius.full },
  chipText: { fontSize: FontSize.xs, fontWeight: FontWeight.bold },

  tabs: {
    flexDirection: 'row', borderBottomWidth: 1, borderColor: Colors.border,
  },
  tab: {
    flex: 1, paddingVertical: Spacing.md, alignItems: 'center',
  },
  tabSel:     { borderBottomWidth: 2, borderColor: Colors.green600 },
  tabText:    { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.gray500 },
  tabTextSel: { color: Colors.green700, fontWeight: FontWeight.bold },

  tabContent: { maxHeight: 360 },
  center:     { paddingVertical: Spacing.xxxl, alignItems: 'center' },
  empty:      { textAlign: 'center', color: Colors.gray400, fontSize: FontSize.base, padding: Spacing.xxl },

  tableRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderColor: Colors.gray100,
  },
  tableHeader: { backgroundColor: Colors.gray50 },
  tableFooter: { backgroundColor: Colors.green50, borderTopWidth: 1, borderTopColor: Colors.border },
  colProduct:  { flex: 1, fontSize: FontSize.sm, color: Colors.gray800 },
  colQty:      { width: rs(44), textAlign: 'right', fontSize: FontSize.sm, color: Colors.gray700 },
  colOrders:   { width: rs(56), textAlign: 'right', fontSize: FontSize.sm, color: Colors.gray700 },
  colRev:      { width: rs(90), textAlign: 'right', fontSize: FontSize.sm, color: Colors.gray700 },
  colHead:     { fontWeight: FontWeight.bold, color: Colors.gray500, fontSize: FontSize.xs, textTransform: 'uppercase' },
  footerText:  { fontWeight: FontWeight.bold, color: Colors.green700 },

  orderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderColor: Colors.gray100,
  },
  orderRowVoided: { opacity: 0.55 },
  orderNum:       { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray800 },
  orderNumVoided: { color: Colors.gray400, textDecorationLine: 'line-through' },
  orderMeta:      { fontSize: FontSize.xs, color: Colors.gray500, marginTop: 2 },
  orderTotal:     { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.green700 },
  orderTotalVoided: { color: Colors.gray400, textDecorationLine: 'line-through' },
  voidedBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.full,
    backgroundColor: Colors.dangerBg,
  },
  voidedBadgeText: { fontSize: FontSize.xs, color: Colors.danger, fontWeight: FontWeight.bold },

  switchBanner: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xs,
    backgroundColor: Colors.warningBg,
    borderBottomWidth: 1, borderColor: Colors.warning + '44',
  },
  switchBannerText: {
    fontSize: FontSize.xs, fontWeight: FontWeight.bold, color: Colors.warning,
  },
});
