import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import AdminLayout from './AdminLayout';
import {
  getOrdersInRange, getLifetimeStats, getProductCategoryCount, LifetimeStats,
} from '../../firebase/firestoreService';
import { useAuthStore } from '../../store/authStore';
import { Order, PaymentMethod } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing, rs,
} from '../../constants/theme';

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getDayRange(date: Date): { start: string; end: string } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end   = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function dateLabel(date: Date): string {
  return date.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
}

function isoDateKey(iso: string): string {
  return iso.slice(0, 10);
}

const PAY_LABELS: Record<PaymentMethod, string> = {
  cash:      'Cash',
  card:      'Card',
  qr:        'QR',
  gift_card: 'Gift Card',
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PH', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function fmtPeso(n: number): string {
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const role    = useAuthStore(useShallow((s) => s.user?.role));
  const isAdmin = role === 'admin';

  const [todayOrders,   setTodayOrders]   = useState<Order[]>([]);
  const [weekOrders,    setWeekOrders]    = useState<Order[]>([]);
  const [lifetime,      setLifetime]      = useState<LifetimeStats | null>(null);
  const [prodCatCount,  setProdCatCount]  = useState<{ product_count: number; category_count: number } | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const now   = new Date();
      const today = getDayRange(now);

      const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      const weekRange = { start: weekStart.toISOString(), end: today.end };

      // Essential: today + week orders. Failure here blocks the whole dashboard.
      const [tOrders, wOrders] = await Promise.all([
        getOrdersInRange(today.start, today.end),
        getOrdersInRange(weekRange.start, weekRange.end),
      ]);
      setTodayOrders(tOrders);
      setWeekOrders(wOrders);

      // Optional: lifetime stats + counts. Failures are silent — sections just stay hidden.
      getLifetimeStats().then(setLifetime).catch(() => {});
      getProductCategoryCount().then(setProdCatCount).catch(() => {});
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Failed to load orders. ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  // ── Derived stats (exclude cancelled) ──
  const active  = todayOrders.filter((o) => o.status !== 'cancelled');
  const voided  = todayOrders.filter((o) => o.status === 'cancelled');
  const revenue = active.reduce((s, o) => s + o.total_amount, 0);
  const avg     = active.length > 0 ? revenue / active.length : 0;

  const todayProfit = active.reduce(
    (s, o) => s + (o.items ?? []).reduce(
      (is, i) => is + (i.unit_price - i.unit_cost) * i.quantity, 0,
    ), 0,
  );

  const byMethod = active.reduce<Record<string, { amount: number; count: number }>>(
    (acc, o) => {
      const k = o.payment_method;
      if (!acc[k]) acc[k] = { amount: 0, count: 0 };
      acc[k].amount += o.total_amount;
      acc[k].count  += 1;
      return acc;
    }, {},
  );

  // ── Top 5 products (today, non-cancelled) ──
  const productMap: Record<string, { name: string; qty: number; revenue: number }> = {};
  for (const order of active) {
    for (const item of (order.items ?? [])) {
      if (!productMap[item.product_id]) {
        productMap[item.product_id] = { name: item.product_name, qty: 0, revenue: 0 };
      }
      productMap[item.product_id].qty     += item.quantity;
      productMap[item.product_id].revenue += item.subtotal;
    }
  }
  const top5 = Object.values(productMap)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  // ── 7-day table ──
  const weekActive = weekOrders.filter((o) => o.status !== 'cancelled');
  const dayMap: Record<string, { revenue: number; profit: number }> = {};
  for (const order of weekActive) {
    const key = isoDateKey(order.created_at);
    if (!dayMap[key]) dayMap[key] = { revenue: 0, profit: 0 };
    dayMap[key].revenue += order.total_amount;
    dayMap[key].profit  += (order.items ?? []).reduce(
      (s, i) => s + (i.unit_price - i.unit_cost) * i.quantity, 0,
    );
  }
  const days7: { label: string; key: string; revenue: number; profit: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days7.push({ label: dateLabel(d), key, revenue: dayMap[key]?.revenue ?? 0, profit: dayMap[key]?.profit ?? 0 });
  }

  return (
    <AdminLayout active="Dashboard">
      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        {/* Page header */}
        <View style={s.pageHeader}>
          <View>
            <Text style={s.pageTitle}>Dashboard</Text>
            <Text style={s.pageDate}>{fmtDate(new Date().toISOString())}</Text>
          </View>
          <TouchableOpacity style={s.refreshBtn} onPress={load} disabled={loading}>
            <Text style={s.refreshText}>{loading ? '…' : '↻ Refresh'}</Text>
          </TouchableOpacity>
        </View>

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : loading ? (
          <View style={s.loadingBox}>
            <ActivityIndicator size="large" color={Colors.green600} />
          </View>
        ) : (
          <>
            {/* Stat cards */}
            <View style={s.statsRow}>
              <StatCard
                label="Today's Revenue"
                value={fmtPeso(revenue)}
                color={Colors.green700}
              />
              <StatCard
                label="Orders"
                value={`${active.length}${voided.length > 0 ? ` (${voided.length} voided)` : ''}`}
                color={Colors.info}
              />
              {isAdmin ? (
                <StatCard
                  label="Today's Profit"
                  value={fmtPeso(todayProfit)}
                  color={todayProfit >= 0 ? Colors.green700 : Colors.danger}
                />
              ) : (
                <StatCard
                  label="Avg Order Value"
                  value={`₱${avg.toFixed(2)}`}
                  color={Colors.gray700}
                />
              )}
            </View>

            {/* All-Time Stats */}
            {lifetime && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>All-Time Stats</Text>
                <View style={s.statsRow}>
                  <StatCard
                    label="Total Revenue"
                    value={fmtPeso(lifetime.total_revenue)}
                    color={Colors.green700}
                  />
                  {isAdmin && (
                    <StatCard
                      label="Total Profit"
                      value={fmtPeso(lifetime.total_profit)}
                      color={lifetime.total_profit >= 0 ? Colors.info : Colors.danger}
                    />
                  )}
                  {prodCatCount && (
                    <>
                      <StatCard
                        label="Products"
                        value={String(prodCatCount.product_count)}
                        color={Colors.gray700}
                      />
                      <StatCard
                        label="Categories"
                        value={String(prodCatCount.category_count)}
                        color={Colors.gray700}
                      />
                    </>
                  )}
                </View>
                {lifetime.by_status.length > 0 && (
                  <View style={s.statusRow}>
                    {lifetime.by_status.map(({ status, count }) => (
                      <View
                        key={status}
                        style={[s.statusChip, status === 'cancelled' && s.statusChipVoided]}
                      >
                        <Text style={[s.statusCount, status === 'cancelled' && s.statusCountVoided]}>
                          {count}
                        </Text>
                        <Text style={[s.statusLabel, status === 'cancelled' && s.statusLabelVoided]}>
                          {status === 'completed' ? 'Completed' : status === 'cancelled' ? 'Voided' : status}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Payment breakdown */}
            {Object.keys(byMethod).length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Payment Breakdown</Text>
                <View style={s.methodGrid}>
                  {(Object.entries(byMethod) as [PaymentMethod, { amount: number; count: number }][])
                    .sort((a, b) => b[1].amount - a[1].amount)
                    .map(([method, data]) => (
                      <View key={method} style={s.methodCard}>
                        <Text style={s.methodLabel}>
                          {PAY_LABELS[method] ?? method}
                        </Text>
                        <Text style={s.methodAmount}>
                          {fmtPeso(data.amount)}
                        </Text>
                        <Text style={s.methodCount}>{data.count} order{data.count !== 1 ? 's' : ''}</Text>
                      </View>
                    ))}
                </View>
              </View>
            )}

            {/* Top 5 Products */}
            {top5.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Top Products Today</Text>
                <View style={s.tableCard}>
                  <View style={[s.tableRow, s.tableHeader]}>
                    <Text style={[s.tableCell, s.tableCellFlex, s.tableHeaderText]}>Product</Text>
                    <Text style={[s.tableCell, s.tableHeaderText, { width: rs(48), textAlign: 'right' }]}>Qty</Text>
                    <Text style={[s.tableCell, s.tableHeaderText, { width: rs(96), textAlign: 'right' }]}>Revenue</Text>
                  </View>
                  {top5.map((p, idx) => (
                    <View key={idx} style={[s.tableRow, idx < top5.length - 1 && s.tableRowBorder]}>
                      <Text style={[s.tableCell, s.tableCellFlex, s.tableCellText]} numberOfLines={1}>{p.name}</Text>
                      <Text style={[s.tableCell, { width: rs(48), textAlign: 'right', color: Colors.gray700 }]}>{p.qty}</Text>
                      <Text style={[s.tableCell, { width: rs(96), textAlign: 'right', color: Colors.green700, fontWeight: FontWeight.semibold }]}>
                        {fmtPeso(p.revenue)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* 7-Day Revenue Table */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>7-Day Revenue{isAdmin ? ' & Profit' : ''}</Text>
              <View style={s.tableCard}>
                <View style={[s.tableRow, s.tableHeader]}>
                  <Text style={[s.tableCell, s.tableCellFlex, s.tableHeaderText]}>Date</Text>
                  <Text style={[s.tableCell, s.tableHeaderText, { width: rs(96), textAlign: 'right' }]}>Revenue</Text>
                  {isAdmin && (
                    <Text style={[s.tableCell, s.tableHeaderText, { width: rs(96), textAlign: 'right' }]}>Profit</Text>
                  )}
                </View>
                {days7.map((day, idx) => {
                  const isToday = idx === days7.length - 1;
                  return (
                    <View key={day.key} style={[s.tableRow, idx < days7.length - 1 && s.tableRowBorder, isToday && s.tableRowToday]}>
                      <Text style={[s.tableCell, s.tableCellFlex, s.tableCellText, isToday && { fontWeight: FontWeight.bold }]}>
                        {isToday ? 'Today' : day.label}
                      </Text>
                      <Text style={[s.tableCell, { width: rs(96), textAlign: 'right', color: day.revenue > 0 ? Colors.green700 : Colors.gray400, fontWeight: FontWeight.medium }]}>
                        {day.revenue > 0 ? fmtPeso(day.revenue) : '—'}
                      </Text>
                      {isAdmin && (
                        <Text style={[s.tableCell, { width: rs(96), textAlign: 'right', color: day.profit > 0 ? Colors.info : day.profit < 0 ? Colors.danger : Colors.gray400, fontWeight: FontWeight.medium }]}>
                          {day.revenue > 0 ? fmtPeso(day.profit) : '—'}
                        </Text>
                      )}
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Recent orders */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>Today's Orders</Text>
              {todayOrders.length === 0 ? (
                <Text style={s.emptyText}>No orders yet today.</Text>
              ) : (
                todayOrders.slice(0, 20).map((order) => (
                  <View
                    key={order.id}
                    style={[s.orderRow, order.status === 'cancelled' && s.orderVoided]}
                  >
                    <View style={s.orderMain}>
                      <Text style={[s.orderNum, order.status === 'cancelled' && s.strikethrough]}>
                        #{order.order_number}
                      </Text>
                      <Text style={s.orderMeta}>
                        {fmtTime(order.created_at)} · {(order.items ?? []).length} item{(order.items ?? []).length !== 1 ? 's' : ''}
                        {' · '}{PAY_LABELS[order.payment_method] ?? order.payment_method}
                      </Text>
                    </View>
                    {order.status === 'cancelled' ? (
                      <Text style={s.voidedBadge}>Voided</Text>
                    ) : (
                      <Text style={s.orderTotal}>{fmtPeso(order.total_amount)}</Text>
                    )}
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
    </AdminLayout>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={[sc.card, { borderTopColor: color }]}>
      <Text style={sc.label}>{label}</Text>
      <Text style={[sc.value, { color }]}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  scroll:  { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.xl, gap: Spacing.xl },

  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  pageTitle: {
    fontSize: FontSize.display,
    fontWeight: FontWeight.bold,
    color: Colors.gray900,
  },
  pageDate: {
    fontSize: FontSize.base,
    color: Colors.gray500,
    marginTop: 2,
  },
  refreshBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  refreshText: {
    fontSize: FontSize.sm,
    color: Colors.green700,
    fontWeight: FontWeight.semibold,
  },

  loadingBox: {
    paddingVertical: Spacing.xxxl,
    alignItems: 'center',
  },
  errorBox: {
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.md,
    padding: Spacing.lg,
  },
  errorText: { color: Colors.danger, fontSize: FontSize.base },

  statsRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },

  section: { gap: Spacing.md },
  sectionTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.gray800,
  },

  methodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  methodCard: {
    flex: 1,
    minWidth: 120,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  methodLabel: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
    fontWeight: FontWeight.medium,
  },
  methodAmount: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.gray900,
  },
  methodCount: {
    fontSize: FontSize.xs,
    color: Colors.gray400,
  },

  tableCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    ...Shadow.sm,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  tableRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tableRowToday: {
    backgroundColor: Colors.green50,
  },
  tableHeader: {
    backgroundColor: Colors.gray50,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tableHeaderText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.gray500,
    textTransform: 'uppercase',
  },
  tableCell: {
    fontSize: FontSize.sm,
  },
  tableCellFlex: { flex: 1 },
  tableCellText: { color: Colors.gray800 },

  orderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  orderVoided: { opacity: 0.55 },
  orderMain: { flex: 1 },
  orderNum: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray800,
  },
  strikethrough: { textDecorationLine: 'line-through' },
  orderMeta: {
    fontSize: FontSize.xs,
    color: Colors.gray500,
    marginTop: 2,
  },
  orderTotal: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.green700,
  },
  voidedBadge: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.danger,
    backgroundColor: Colors.dangerBg,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  emptyText: {
    fontSize: FontSize.base,
    color: Colors.gray400,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },

  statusRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    flexWrap: 'wrap',
  },
  statusChip: {
    flex: 1,
    minWidth: 100,
    backgroundColor: Colors.green50,
    borderRadius: Radius.md,
    padding: Spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.green200,
  },
  statusChipVoided: {
    backgroundColor: Colors.dangerBg,
    borderColor: Colors.danger + '44',
  },
  statusCount: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.extrabold,
    color: Colors.green700,
  },
  statusCountVoided: {
    color: Colors.danger,
  },
  statusLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    color: Colors.green600,
    marginTop: 2,
  },
  statusLabelVoided: {
    color: Colors.danger,
  },
});

const sc = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderTopWidth: 3,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  label: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
    fontWeight: FontWeight.medium,
  },
  value: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.extrabold,
  },
});
