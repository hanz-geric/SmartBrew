import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AdminLayout from './AdminLayout';
import { AdminStackParamList } from '../../navigation/AdminStack';
import { getOrdersBySession } from '../../firebase/firestoreService';
import { CashSession, Order, PaymentMethod } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing, rs,
} from '../../constants/theme';

type Nav   = NativeStackNavigationProp<AdminStackParamList>;
type Route = RouteProp<AdminStackParamList, 'SessionDetail'>;

type DrillTab = 'summary' | 'orders';

const PAY_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash', card: 'Card', qr: 'QR', gift_card: 'Gift',
};

const TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine In', takeaway: 'Takeaway', delivery: 'Delivery',
};

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

function Chip({ label, green, danger, warning }: { label: string; green?: boolean; danger?: boolean; warning?: boolean }) {
  const bg   = danger ? Colors.dangerBg  : green ? Colors.green50  : warning ? Colors.warningBg : Colors.gray100;
  const text = danger ? Colors.danger    : green ? Colors.green700 : warning ? Colors.warning   : Colors.gray600;
  return (
    <View style={[s.chip, { backgroundColor: bg }]}>
      <Text style={[s.chipText, { color: text }]}>{label}</Text>
    </View>
  );
}

export default function SessionDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route      = useRoute<Route>();
  const { session } = route.params;

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
  const revenue       = activeOrders.reduce((sum, o) => sum + o.total_amount, 0);
  const cashCollected = activeOrders
    .filter((o) => o.payment_method === 'cash')
    .reduce((sum, o) => sum + o.total_amount, 0);

  const productStats = buildProductStats(orders);
  const statTotal    = productStats.reduce((sum, p) => sum + p.revenue, 0);

  const cashierNames = [...new Set(orders.map((o) => o.cashier_name).filter(Boolean))];
  const hadSwitches  = cashierNames.length > 1;

  return (
    <AdminLayout active="Sessions">
      <View style={s.root}>

        {/* Page header */}
        <View style={s.pageHeader}>
          <View style={s.headerLeft}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
              <Text style={s.backText}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={s.pageTitle}>{session.cashier_name}</Text>
            <Text style={s.pageDate}>{fmtDateTime(session.start_time)}</Text>
            {session.end_time && (
              <Text style={s.pageDuration}>
                Duration: {duration(session.start_time, session.end_time)}
              </Text>
            )}
          </View>
          <View style={[s.statusBadge, session.status === 'open' && s.statusOpen]}>
            <Text style={[s.statusText, session.status === 'open' && s.statusOpenText]}>
              {session.status === 'open' ? 'Open' : 'Closed'}
            </Text>
          </View>
        </View>

        {/* Summary chips */}
        {!loading && (
          <View style={s.chips}>
            <Chip label={`${orders.length} orders`} />
            <Chip label={`₱${revenue.toFixed(2)} revenue`} green />
            <Chip label={`₱${cashCollected.toFixed(2)} cash`} />
            {voidedCount > 0 && <Chip label={`${voidedCount} voided`} danger />}
            {hadSwitches && <Chip label={`⇄ ${cashierNames.length} cashiers`} warning />}
          </View>
        )}

        {/* Cash grid */}
        <View style={s.cashGrid}>
          <CashCell label="Starting"  value={`₱${session.starting_cash.toFixed(2)}`} />
          <CashCell label="Collected" value={`₱${(session.cash_collected ?? 0).toFixed(2)}`} />
          <CashCell
            label="Expected"
            value={session.expected_cash !== null ? `₱${session.expected_cash?.toFixed(2)}` : '—'}
          />
          <CashCell
            label="Actual"
            value={session.actual_cash !== null ? `₱${session.actual_cash?.toFixed(2)}` : '—'}
          />
        </View>

        {/* Cashier switch log */}
        {hadSwitches && (
          <View style={s.switchBanner}>
            <Text style={s.switchTitle}>Cashier switches during this session</Text>
            <View style={s.switchList}>
              {cashierNames.map((name, i) => (
                <View key={i} style={s.switchItem}>
                  <View style={s.switchDot} />
                  <Text style={s.switchName}>{name}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Tabs */}
        <View style={s.tabs}>
          <TouchableOpacity
            style={[s.tab, tab === 'summary' && s.tabSel]}
            onPress={() => setTab('summary')}
          >
            <Text style={[s.tabText, tab === 'summary' && s.tabTextSel]}>Product Summary</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tab, tab === 'orders' && s.tabSel]}
            onPress={() => setTab('orders')}
          >
            <Text style={[s.tabText, tab === 'orders' && s.tabTextSel]}>
              Orders{orders.length > 0 ? ` (${orders.length})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={Colors.green600} />
          </View>
        ) : tab === 'summary' ? (
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
            <View style={s.tableCard}>
              <View style={[s.tableRow, s.tableHeader]}>
                <Text style={[s.colProduct, s.colHead]}>Product</Text>
                <Text style={[s.colQty,     s.colHead]}>Qty</Text>
                <Text style={[s.colOrders,  s.colHead]}>Orders</Text>
                <Text style={[s.colRev,     s.colHead]}>Revenue</Text>
              </View>
              {productStats.length === 0 ? (
                <Text style={s.empty}>No completed orders in this session.</Text>
              ) : (
                productStats.map((stat) => (
                  <View key={stat.name} style={s.tableRow}>
                    <Text style={s.colProduct} numberOfLines={1}>{stat.name}</Text>
                    <Text style={s.colQty}>{stat.qty}</Text>
                    <Text style={s.colOrders}>{stat.orderCount}</Text>
                    <Text style={s.colRev}>₱{stat.revenue.toFixed(2)}</Text>
                  </View>
                ))
              )}
              {productStats.length > 0 && (
                <View style={[s.tableRow, s.tableFooter]}>
                  <Text style={[s.colProduct, s.footerText]}>Total</Text>
                  <Text style={s.colQty} />
                  <Text style={s.colOrders} />
                  <Text style={[s.colRev, s.footerText]}>₱{statTotal.toFixed(2)}</Text>
                </View>
              )}
            </View>
          </ScrollView>
        ) : (
          <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
            {orders.length === 0 ? (
              <Text style={s.empty}>No orders in this session.</Text>
            ) : (
              orders.map((order) => {
                const isVoided  = order.status === 'cancelled';
                const cashierTag = hadSwitches && order.cashier_name ? order.cashier_name : null;
                return (
                  <View key={order.id} style={[s.orderRow, isVoided && s.orderRowVoided]}>
                    <View style={{ flex: 1 }}>
                      <View style={s.orderTopRow}>
                        <Text style={[s.orderNum, isVoided && s.orderNumVoided]}>
                          #{order.order_number}
                        </Text>
                        {cashierTag && (
                          <View style={s.cashierTag}>
                            <Text style={s.cashierTagText}>{cashierTag}</Text>
                          </View>
                        )}
                        {isVoided && (
                          <View style={s.voidedBadge}>
                            <Text style={s.voidedBadgeText}>Voided</Text>
                          </View>
                        )}
                      </View>
                      <Text style={s.orderMeta}>
                        {fmtTime(order.created_at)}
                        {' · '}{TYPE_LABELS[order.order_type] ?? order.order_type}
                        {' · '}{PAY_LABELS[order.payment_method] ?? order.payment_method}
                      </Text>
                    </View>
                    <Text style={[s.orderTotal, isVoided && s.orderTotalVoided]}>
                      ₱{order.total_amount.toFixed(2)}
                    </Text>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}
      </View>
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
  root:  { flex: 1, backgroundColor: Colors.background },

  pageHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, paddingBottom: Spacing.md,
  },
  headerLeft:   { flex: 1, gap: 2 },
  backBtn:      {},
  backText:     { fontSize: FontSize.sm, color: Colors.green700, fontWeight: FontWeight.medium },
  pageTitle:    { fontSize: FontSize.display, fontWeight: FontWeight.bold, color: Colors.gray900 },
  pageDate:     { fontSize: FontSize.sm, color: Colors.gray500 },
  pageDuration: { fontSize: FontSize.sm, color: Colors.gray400 },

  statusBadge: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: Radius.full, backgroundColor: Colors.gray100, alignSelf: 'flex-start',
  },
  statusOpen:     { backgroundColor: Colors.green100 },
  statusText:     { fontSize: FontSize.xs, fontWeight: FontWeight.bold, color: Colors.gray600 },
  statusOpenText: { color: Colors.green700 },

  chips: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm,
    paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md,
  },
  chip:     { paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: Radius.full },
  chipText: { fontSize: FontSize.xs, fontWeight: FontWeight.bold },

  cashGrid: {
    flexDirection: 'row',
    marginHorizontal: Spacing.xl,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface, marginBottom: Spacing.md,
  },

  switchBanner: {
    marginHorizontal: Spacing.xl, marginBottom: Spacing.md,
    backgroundColor: Colors.warningBg, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.warning + '44',
  },
  switchTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.warning },
  switchList:  { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  switchItem:  { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  switchDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.warning },
  switchName:  { fontSize: FontSize.sm, color: Colors.gray700, fontWeight: FontWeight.medium },

  tabs: {
    flexDirection: 'row',
    marginHorizontal: Spacing.xl, marginBottom: Spacing.md,
    borderRadius: Radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  tab:        { flex: 1, paddingVertical: Spacing.md, alignItems: 'center' },
  tabSel:     { backgroundColor: Colors.green600 },
  tabText:    { fontSize: FontSize.sm, fontWeight: FontWeight.medium, color: Colors.gray500 },
  tabTextSel: { color: Colors.white, fontWeight: FontWeight.bold },

  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl, gap: Spacing.md },
  center:        { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: {
    textAlign: 'center', color: Colors.gray400,
    fontSize: FontSize.base, padding: Spacing.xxl,
  },

  tableCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    overflow: 'hidden', ...Shadow.sm,
  },
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
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    padding: Spacing.lg, gap: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  orderRowVoided: { opacity: 0.55 },
  orderTopRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  orderNum:       { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray800 },
  orderNumVoided: { color: Colors.gray400, textDecorationLine: 'line-through' },
  orderMeta:      { fontSize: FontSize.xs, color: Colors.gray500, marginTop: 2 },
  orderTotal:     { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.green700 },
  orderTotalVoided: { color: Colors.gray400, textDecorationLine: 'line-through' },

  cashierTag: {
    paddingHorizontal: Spacing.sm, paddingVertical: 1,
    borderRadius: Radius.full, backgroundColor: Colors.warningBg,
    borderWidth: 1, borderColor: Colors.warning + '44',
  },
  cashierTagText: { fontSize: FontSize.xs, color: Colors.warning, fontWeight: FontWeight.bold },

  voidedBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: Radius.full,
    backgroundColor: Colors.dangerBg,
  },
  voidedBadgeText: { fontSize: FontSize.xs, color: Colors.danger, fontWeight: FontWeight.bold },
});

const cc = StyleSheet.create({
  cell: {
    flex: 1, padding: Spacing.md, alignItems: 'center',
    borderRightWidth: 1, borderColor: Colors.border,
  },
  label: { fontSize: FontSize.xs, color: Colors.gray500, fontWeight: FontWeight.medium, marginBottom: 2 },
  value: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.gray800 },
});
