import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import AdminLayout from './AdminLayout';
import SessionsPanel from './SessionsPanel';
import OrdersPanel from './OrdersPanel';
import { getOrdersInRange } from '../../firebase/firestoreService';
import { exportCsv } from '../../utils/csvExport';
import { useAuthStore } from '../../store/authStore';
import { Order } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing, rs,
} from '../../constants/theme';

// ─── Types ────────────────────────────────────────────────────────────────────

type ReportsTab = 'analytics' | 'sessions' | 'orders';
type Period     = 'daily' | 'weekly' | 'monthly';

interface Bucket {
  key:     string;
  label:   string;
  revenue: number;
  profit:  number;
  count:   number;
}

interface HourBucket {
  hour:  number;
  label: string;
  count: number;
}

interface TopProduct {
  name: string;
  qty:  number;
}

interface PayBreakdown {
  method:  string;
  label:   string;
  revenue: number;
  count:   number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<Period, string> = {
  daily:   'Daily (30d)',
  weekly:  'Weekly (12w)',
  monthly: 'Monthly (12m)',
};

const CHART_H = rs(144);
const PEAK_H  = rs(96);

const PAY_LABELS: Record<string, string> = {
  cash:      'Cash',
  card:      'Card',
  qr:        'QR',
  gift_card: 'Gift Card',
  pay_later: 'Pay Later',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPeso(n: number): string {
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPesoShort(n: number): string {
  if (n >= 1_000_000) return `₱${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `₱${(n / 1_000).toFixed(1)}k`;
  return `₱${n.toFixed(0)}`;
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }

function mondayOf(d: Date): Date {
  const c = new Date(d);
  c.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  c.setHours(0, 0, 0, 0);
  return c;
}

function rangeFor(period: Period): { start: string; end: string } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  let start: Date;
  if (period === 'daily') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  } else if (period === 'weekly') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 83);
  } else {
    start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  }
  start.setHours(0, 0, 0, 0);
  return { start: start.toISOString(), end: end.toISOString() };
}

function buildBuckets(orders: Order[], period: Period): Bucket[] {
  const now = new Date();

  if (period === 'daily') {
    const buckets: (Bucket & { date: Date })[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const label = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
      buckets.push({ date: d, key, label, revenue: 0, profit: 0, count: 0 });
    }
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      const t = new Date(o.created_at).getTime();
      for (const b of buckets) {
        const next = new Date(b.date); next.setDate(next.getDate() + 1);
        if (t >= b.date.getTime() && t < next.getTime()) {
          b.revenue += o.total_amount;
          b.profit  += (o.items ?? []).reduce((s, i) => s + (i.unit_price - i.unit_cost) * i.quantity, 0);
          b.count++;
          break;
        }
      }
    }
    return buckets;
  }

  if (period === 'weekly') {
    const buckets: (Bucket & { weekStart: Date })[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i * 7);
      const m = mondayOf(d);
      const key   = `${m.getFullYear()}-${pad2(m.getMonth() + 1)}-${pad2(m.getDate())}`;
      const label = m.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
      if (!buckets.find((b) => b.weekStart.getTime() === m.getTime()))
        buckets.push({ weekStart: new Date(m), key, label, revenue: 0, profit: 0, count: 0 });
    }
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      const t = new Date(o.created_at).getTime();
      for (let i = 0; i < buckets.length; i++) {
        const nextWeek = i + 1 < buckets.length ? buckets[i + 1].weekStart.getTime() : Infinity;
        if (t >= buckets[i].weekStart.getTime() && t < nextWeek) {
          buckets[i].revenue += o.total_amount;
          buckets[i].profit  += (o.items ?? []).reduce((s, it) => s + (it.unit_price - it.unit_cost) * it.quantity, 0);
          buckets[i].count++;
          break;
        }
      }
    }
    return buckets;
  }

  // monthly
  const buckets: (Bucket & { month: Date })[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key   = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    const label = d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' });
    buckets.push({ month: d, key, label, revenue: 0, profit: 0, count: 0 });
  }
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    const t = new Date(o.created_at);
    for (const b of buckets) {
      if (t.getFullYear() === b.month.getFullYear() && t.getMonth() === b.month.getMonth()) {
        b.revenue += o.total_amount;
        b.profit  += (o.items ?? []).reduce((s, i) => s + (i.unit_price - i.unit_cost) * i.quantity, 0);
        b.count++;
        break;
      }
    }
  }
  return buckets;
}

function buildHourBuckets(orders: Order[]): HourBucket[] {
  const counts = Array.from({ length: 24 }, (_, h) => {
    const hh   = h % 12 || 12;
    const ampm = h < 12 ? 'am' : 'pm';
    return { hour: h, label: `${hh}${ampm}`, count: 0 };
  });
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    counts[new Date(o.created_at).getHours()].count++;
  }
  return counts;
}

function buildTopProducts(orders: Order[]): TopProduct[] {
  const map: Record<string, number> = {};
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    for (const item of (o.items ?? []))
      map[item.product_name] = (map[item.product_name] ?? 0) + item.quantity;
  }
  return Object.entries(map)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);
}

function buildPayBreakdown(orders: Order[]): PayBreakdown[] {
  const map: Record<string, { revenue: number; count: number }> = {};
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    const m = o.payment_method;
    if (!map[m]) map[m] = { revenue: 0, count: 0 };
    map[m].revenue += o.total_amount;
    map[m].count++;
  }
  return Object.entries(map)
    .map(([method, d]) => ({ method, label: PAY_LABELS[method] ?? method, ...d }))
    .sort((a, b) => b.revenue - a.revenue);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RevenueChart({ buckets, showProfit, period }: {
  buckets:    Bucket[];
  showProfit: boolean;
  period:     Period;
}) {
  const max        = Math.max(...buckets.map((b) => b.revenue), 1);
  const hasData    = buckets.some((b) => b.revenue > 0);
  const totalRev   = buckets.reduce((s, b) => s + b.revenue, 0);
  const totalProfit= buckets.reduce((s, b) => s + b.profit,  0);
  const totalCount = buckets.reduce((s, b) => s + b.count,   0);
  const avgOrder   = totalCount > 0 ? totalRev / totalCount : 0;
  const labelStep  = period === 'daily' ? 5 : 1;

  return (
    <View style={c.card}>
      <Text style={c.cardTitle}>Revenue</Text>

      {/* Vertical bars */}
      <View style={[c.barArea, { height: CHART_H }]}>
        {buckets.map((b, i) => {
          const pct = b.revenue > 0 ? Math.max((b.revenue / max) * 100, 4) : 0.5;
          return (
            <View key={i} style={c.barCol}>
              <View
                style={[
                  c.bar,
                  {
                    height:          `${pct}%` as unknown as number,
                    backgroundColor: b.revenue > 0 ? Colors.green700 : Colors.gray100,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>

      {/* X-axis labels */}
      <View style={c.labelRow}>
        {buckets.map((b, i) => (
          <View key={i} style={c.labelCol}>
            {(i % labelStep === 0 || i === buckets.length - 1) && (
              <Text style={c.axisLabel} numberOfLines={1}>{b.label}</Text>
            )}
          </View>
        ))}
      </View>

      {!hasData && (
        <Text style={c.emptyText}>No data for this period</Text>
      )}

      {/* Summary stats */}
      {hasData && (
        <View style={c.summaryRow}>
          <View style={c.summaryItem}>
            <Text style={c.summaryLabel}>Revenue</Text>
            <Text style={[c.summaryValue, { color: Colors.green700 }]}>{fmtPesoShort(totalRev)}</Text>
          </View>
          {showProfit && (
            <View style={c.summaryItem}>
              <Text style={c.summaryLabel}>Profit</Text>
              <Text style={[c.summaryValue, { color: Colors.info }]}>{fmtPesoShort(totalProfit)}</Text>
            </View>
          )}
          <View style={c.summaryItem}>
            <Text style={c.summaryLabel}>Orders</Text>
            <Text style={[c.summaryValue, { color: Colors.gray800 }]}>{totalCount}</Text>
          </View>
          <View style={c.summaryItem}>
            <Text style={c.summaryLabel}>Avg Order</Text>
            <Text style={[c.summaryValue, { color: Colors.gray800 }]}>{fmtPesoShort(avgOrder)}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function TopProductsTable({ products }: { products: TopProduct[] }) {
  const maxQty = Math.max(...products.map((p) => p.qty), 1);
  return (
    <View style={c.card}>
      <Text style={c.cardTitle}>Top Products</Text>
      {products.length === 0 ? (
        <Text style={c.emptyText}>No sales data</Text>
      ) : (
        products.map((p, i) => (
          <View key={p.name} style={[t.row, i < products.length - 1 && t.rowBorder]}>
            <Text style={t.rank}>{i + 1}</Text>
            <View style={t.nameWrap}>
              <View style={t.nameRow}>
                <Text style={t.name} numberOfLines={1}>{p.name}</Text>
                <Text style={t.qty}>×{p.qty}</Text>
              </View>
              <View style={t.track}>
                <View
                  style={[
                    t.fill,
                    { width: `${(p.qty / maxQty) * 100}%` as unknown as number },
                    i === 0 ? t.fill1 : i < 3 ? t.fill2 : t.fill3,
                  ]}
                />
              </View>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function PayBreakdownChart({ breakdown }: { breakdown: PayBreakdown[] }) {
  const maxRevenue   = Math.max(...breakdown.map((b) => b.revenue), 1);
  const totalRevenue = breakdown.reduce((s, b) => s + b.revenue, 0);
  return (
    <View style={c.card}>
      <Text style={c.cardTitle}>Payment Breakdown</Text>
      {breakdown.length === 0 ? (
        <Text style={c.emptyText}>No data</Text>
      ) : (
        breakdown.map((b, i) => (
          <View key={b.method} style={[pb.row, i < breakdown.length - 1 && pb.rowBorder]}>
            <View style={pb.meta}>
              <Text style={pb.methodLabel}>{b.label}</Text>
              <View style={pb.metaRight}>
                <Text style={pb.count}>{b.count} order{b.count !== 1 ? 's' : ''}</Text>
                <Text style={pb.revenue}>{fmtPeso(b.revenue)}</Text>
                <Text style={pb.pct}>
                  {totalRevenue > 0 ? `${((b.revenue / totalRevenue) * 100).toFixed(0)}%` : '—'}
                </Text>
              </View>
            </View>
            <View style={pb.track}>
              <View
                style={[
                  pb.fill,
                  { width: `${(b.revenue / maxRevenue) * 100}%` as unknown as number },
                ]}
              />
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function PeakHoursChart({ hours }: { hours: HourBucket[] }) {
  const max     = Math.max(...hours.map((h) => h.count), 1);
  const hasData = hours.some((h) => h.count > 0);

  return (
    <View style={c.card}>
      <Text style={c.cardTitle}>Peak Hours</Text>

      <View style={[c.barArea, { height: PEAK_H }]}>
        {hours.map((h) => {
          const pct = h.count > 0 ? Math.max((h.count / max) * 100, 4) : 0.5;
          return (
            <View key={h.hour} style={c.barCol}>
              <View
                style={[
                  c.bar,
                  {
                    height:          `${pct}%` as unknown as number,
                    backgroundColor: h.count > 0 ? Colors.green700 : Colors.gray100,
                  },
                ]}
              />
            </View>
          );
        })}
      </View>

      <View style={c.labelRow}>
        {hours.map((h) => (
          <View key={h.hour} style={c.labelCol}>
            {h.hour % 6 === 0 && (
              <Text style={c.axisLabel}>{h.label}</Text>
            )}
          </View>
        ))}
      </View>

      {!hasData && (
        <Text style={c.emptyText}>No data for this period</Text>
      )}
    </View>
  );
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

function buildReportsCsv(
  buckets:     Bucket[],
  topProducts: TopProduct[],
  period:      Period,
  isAdmin:     boolean,
): Parameters<typeof exportCsv> {
  const headers = ['Period', 'Revenue (₱)', 'Orders', 'Avg Order (₱)', ...(isAdmin ? ['Profit (₱)'] : [])];
  const revenueRows = buckets.map((b) => {
    const avg = b.count > 0 ? (b.revenue / b.count).toFixed(2) : '0.00';
    return [b.label, b.revenue.toFixed(2), b.count, avg, ...(isAdmin ? [b.profit.toFixed(2)] : [])];
  });
  const rows: (string | number | null | undefined)[][] = [
    ...revenueRows,
    [],
    ['Product', 'Units Sold'],
    ...topProducts.map((p) => [p.name, p.qty]),
  ];
  return [`reports_${period}_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows];
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const role    = useAuthStore(useShallow((s) => s.user?.role));
  const isAdmin = role === 'admin';

  const [tab,       setTab]       = useState<ReportsTab>('analytics');
  const [period,    setPeriod]    = useState<Period>('daily');
  const [orders,    setOrders]    = useState<Order[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [exporting, setExporting] = useState(false);
  const panelExportRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const { start, end } = rangeFor(period);
        const data = await getOrdersInRange(start, end);
        if (!cancelled) setOrders(data);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [period]);

  const buckets      = buildBuckets(orders, period);
  const hourBuckets  = buildHourBuckets(orders);
  const topProducts  = buildTopProducts(orders);
  const payBreakdown = buildPayBreakdown(orders);
  const hasData      = buckets.some((b) => b.revenue > 0);

  async function handleExport() {
    if (!hasData) return;
    setExporting(true);
    try {
      await exportCsv(...buildReportsCsv(buckets, topProducts, period, isAdmin));
    } catch { /* ignore share cancellation */ }
    finally { setExporting(false); }
  }

  return (
    <AdminLayout active="Reports">
      <View style={s.root}>

        {/* ── Tab bar + header actions ── */}
        <View style={s.tabBar}>
          <View style={s.tabs}>
            {(['analytics', 'sessions', 'orders'] as ReportsTab[]).map((t) => (
              <TouchableOpacity
                key={t}
                style={[s.tab, tab === t && s.tabActive]}
                onPress={() => setTab(t)}
              >
                <Text style={[s.tabText, tab === t && s.tabTextActive]}>
                  {t === 'analytics' ? 'Analytics' : t === 'sessions' ? 'Sessions' : 'Orders'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            style={[s.exportBtn, (tab === 'analytics' && (loading || exporting)) && s.exportBtnOff]}
            onPress={() => tab === 'analytics' ? handleExport() : panelExportRef.current?.()}
            disabled={tab === 'analytics' && (loading || exporting)}
            activeOpacity={0.8}
          >
            <Text style={s.exportBtnText}>{exporting ? '…' : '⬇'}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Analytics tab ── */}
        {tab === 'analytics' && (
          <ScrollView style={s.scroll} contentContainerStyle={s.content}>

            {/* Period picker */}
            <View style={s.pills}>
              {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[s.pill, period === p && s.pillActive]}
                  onPress={() => setPeriod(p)}
                >
                  <Text style={[s.pillText, period === p && s.pillTextActive]}>
                    {PERIOD_LABELS[p]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {error ? (
              <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>
            ) : loading ? (
              <View style={s.loadingBox}><ActivityIndicator size="large" color={Colors.green600} /></View>
            ) : (
              <>
                <RevenueChart buckets={buckets} showProfit={isAdmin} period={period} />
                <TopProductsTable products={topProducts} />
                <PayBreakdownChart breakdown={payBreakdown} />
                <PeakHoursChart hours={hourBuckets} />
              </>
            )}

          </ScrollView>
        )}

        {/* ── Sessions tab ── */}
        {tab === 'sessions' && <SessionsPanel exportRef={panelExportRef} />}

        {/* ── Orders tab ── */}
        {tab === 'orders' && <OrdersPanel exportRef={panelExportRef} />}

      </View>
    </AdminLayout>
  );
}

// ─── Chart styles ─────────────────────────────────────────────────────────────

const c = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         Spacing.lg,
    ...Shadow.sm,
  },
  cardTitle: {
    fontSize:     FontSize.sm,
    fontWeight:   FontWeight.semibold,
    color:        Colors.gray700,
    marginBottom: Spacing.lg,
  },

  barArea: {
    flexDirection: 'row',
    alignItems:    'flex-end',
    gap:           rs(2),
  },
  barCol: {
    flex:           1,
    alignItems:     'stretch',
    justifyContent: 'flex-end',
  },
  bar: {
    width:                  '100%',
    borderTopLeftRadius:    2,
    borderTopRightRadius:   2,
    minHeight:              1,
  },

  labelRow: {
    flexDirection: 'row',
    marginTop:     Spacing.xs,
    gap:           rs(2),
  },
  labelCol: {
    flex:      1,
    alignItems: 'center',
  },
  axisLabel: {
    fontSize: rs(8),
    color:    Colors.gray400,
  },

  emptyText: {
    textAlign:   'center',
    fontSize:    FontSize.xs,
    color:       Colors.gray400,
    marginTop:   Spacing.sm,
  },

  summaryRow: {
    flexDirection:  'row',
    flexWrap:       'wrap',
    gap:            Spacing.lg,
    marginTop:      Spacing.lg,
    paddingTop:     Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.gray100,
  },
  summaryItem: { gap: 2 },
  summaryLabel: {
    fontSize:   FontSize.xs,
    color:      Colors.gray400,
  },
  summaryValue: {
    fontSize:   FontSize.sm,
    fontWeight: FontWeight.bold,
  },
});

// ─── Top products styles ──────────────────────────────────────────────────────

const t = StyleSheet.create({
  row: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    paddingVertical: Spacing.sm,
    gap:             Spacing.sm,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  rank: {
    width:      rs(20),
    fontSize:   FontSize.xs,
    fontWeight: FontWeight.bold,
    color:      Colors.gray300,
    textAlign:  'right',
    paddingTop: 2,
  },
  nameWrap: { flex: 1, gap: Spacing.xs },
  nameRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: {
    flex:       1,
    fontSize:   FontSize.sm,
    fontWeight: FontWeight.medium,
    color:      Colors.gray900,
  },
  qty: {
    fontSize:   FontSize.xs,
    fontWeight: FontWeight.bold,
    color:      Colors.green700,
    marginLeft: Spacing.sm,
  },
  track: {
    height:          rs(6),
    backgroundColor: Colors.gray100,
    borderRadius:    Radius.full,
    overflow:        'hidden',
  },
  fill: {
    height:       '100%',
    borderRadius: Radius.full,
  },
  fill1: { backgroundColor: Colors.green700 },
  fill2: { backgroundColor: Colors.green500 },
  fill3: { backgroundColor: Colors.green200 },
});

// ─── Pay breakdown styles ─────────────────────────────────────────────────────

const pb = StyleSheet.create({
  row: { paddingVertical: Spacing.sm, gap: Spacing.xs },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  meta: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   Spacing.xs,
  },
  metaRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  methodLabel: {
    fontSize:   FontSize.sm,
    fontWeight: FontWeight.medium,
    color:      Colors.gray900,
  },
  count: {
    fontSize: FontSize.xs,
    color:    Colors.gray500,
  },
  revenue: {
    fontSize:   FontSize.xs,
    fontWeight: FontWeight.bold,
    color:      Colors.green700,
  },
  pct: {
    fontSize: FontSize.xs,
    color:    Colors.gray400,
    width:    rs(32),
    textAlign: 'right',
  },
  track: {
    height:          rs(8),
    backgroundColor: Colors.gray100,
    borderRadius:    Radius.full,
    overflow:        'hidden',
  },
  fill: {
    height:          '100%',
    backgroundColor: Colors.green700,
    borderRadius:    Radius.full,
  },
});

// ─── Screen styles ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.background },
  scroll:  { flex: 1 },
  content: { padding: Spacing.xl, gap: Spacing.xl },

  // Tab bar
  tabBar: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   Colors.surface,
    borderBottomWidth: 1,
    borderColor:       Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingRight:      Spacing.xl,
  },
  tabs: {
    flex:          1,
    flexDirection: 'row',
  },
  tab: {
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: Colors.green700,
  },
  tabText: {
    fontSize:   FontSize.sm,
    fontWeight: FontWeight.semibold,
    color:      Colors.gray500,
  },
  tabTextActive: {
    color: Colors.green700,
  },

  // Export button
  exportBtn: {
    borderWidth:       1.5,
    borderColor:       Colors.green600,
    borderRadius:      Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.xs,
  },
  exportBtnOff:  { opacity: 0.5 },
  exportBtnText: {
    fontSize:   FontSize.sm,
    fontWeight: FontWeight.semibold,
    color:      Colors.green700,
  },

  // Period pills
  pills: {
    flexDirection: 'row',
    gap:           Spacing.sm,
    flexWrap:      'wrap',
  },
  pill: {
    paddingHorizontal: Spacing.lg,
    paddingVertical:   Spacing.sm,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       Colors.border,
    backgroundColor:   Colors.surface,
  },
  pillActive: {
    backgroundColor: Colors.green700,
    borderColor:     Colors.green700,
  },
  pillText: {
    fontSize:   FontSize.sm,
    color:      Colors.gray600,
    fontWeight: FontWeight.medium,
  },
  pillTextActive: {
    color:      Colors.white,
    fontWeight: FontWeight.semibold,
  },

  loadingBox: {
    paddingVertical: Spacing.xxxl,
    alignItems:      'center',
  },
  errorBox: {
    backgroundColor: Colors.dangerBg,
    borderRadius:    Radius.md,
    borderWidth:     1,
    borderColor:     Colors.danger + '44',
    padding:         Spacing.lg,
  },
  errorText: { color: Colors.danger, fontSize: FontSize.base },
});
