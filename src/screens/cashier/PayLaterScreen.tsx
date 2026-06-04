import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CashierStackParamList } from '../../navigation/CashierStack';
import { getUnpaidOrdersBySession, settlePaylaterOrder, getSettings } from '../../firebase/firestoreService';
import { Order, PaymentMethod, Settings } from '../../types';
import { buildReceipt } from '../../utils/printerTemplates';
import { printBytes } from '../../services/printerService';
import { useToast } from '../../components/ui';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing, isTablet,
} from '../../constants/theme';

type Props = NativeStackScreenProps<CashierStackParamList, 'PayLater'>;
type SettleMethod = Exclude<PaymentMethod, 'pay_later'>;

const SETTLE_METHODS: { value: SettleMethod; label: string; icon: string }[] = [
  { value: 'cash',      label: 'Cash',      icon: '💵' },
  { value: 'card',      label: 'Card',      icon: '💳' },
  { value: 'qr',        label: 'QR',        icon: '📱' },
  { value: 'gift_card', label: 'Gift Card', icon: '🎁' },
];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PH', {
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins   = Math.floor(diffMs / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

const TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine In', takeaway: 'Takeaway', delivery: 'Delivery',
};

// ─── Payment form (right column of expanded row) ──────────────────────────────
// Owns its own state so re-renders of unrelated cards don't reset it.

interface PayFormProps {
  order:     Order;
  settling:  boolean;
  settings:  Settings;
  onSettle:  (method: SettleMethod, cashReceived?: number, reference?: string) => void;
  onDismiss: () => void;
}

function PayForm({ order, settling, settings, onSettle, onDismiss }: PayFormProps) {
  const toast = useToast();
  const [method,       setMethod]       = useState<SettleMethod>('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [reference,    setReference]   = useState('');
  const [settled,      setSettled]      = useState(false);
  const [paidMethod,   setPaidMethod]   = useState<SettleMethod>('cash');
  const [change,       setChange]       = useState(0);
  const [printing,     setPrinting]     = useState(false);

  const ceilTotal = Math.ceil(order.total_amount);
  const cashNum   = parseFloat(cashReceived) || 0;
  const localChange = method === 'cash' ? Math.max(0, cashNum - ceilTotal) : 0;
  const canSettle   = method !== 'cash' || cashNum >= ceilTotal;

  async function handlePrint() {
    setPrinting(true);
    try {
      const settledOrder: Order = { ...order, payment_method: paidMethod };
      const bytes = buildReceipt(settledOrder, change, settings, paidMethod === 'cash');
      await printBytes(bytes, {
        type:     (settings.receipt_printer_type ?? 'wifi') as 'wifi' | 'bluetooth',
        ip:       settings.receipt_printer_ip,
        port:     settings.receipt_printer_port,
        btDevice: settings.receipt_printer_bt,
      });
    } catch (e: unknown) {
      toast.error((e as Error).message ?? 'Could not reach printer.');
    } finally {
      setPrinting(false);
    }
  }

  function handleSettle() {
    setPaidMethod(method);
    setChange(method === 'cash' ? Math.max(0, cashNum - ceilTotal) : 0);
    onSettle(method, method === 'cash' ? cashNum : undefined, reference || undefined);
    setSettled(true);
  }

  if (settled) {
    return (
      <View style={f.settledRoot}>
        <Text style={f.settledIcon}>✓</Text>
        <Text style={f.settledTitle}>Payment Collected</Text>
        {change > 0 && (
          <View style={f.changeBox}>
            <Text style={f.changeLabel}>Change</Text>
            <Text style={f.changeAmt}>₱{change.toFixed(2)}</Text>
          </View>
        )}
        <TouchableOpacity
          style={[f.printBtn, printing && f.btnOff]}
          onPress={handlePrint}
          disabled={printing}
          activeOpacity={0.8}
        >
          {printing
            ? <ActivityIndicator color={Colors.white} size="small" />
            : <Text style={f.printBtnText}>🖨  Print Receipt</Text>
          }
        </TouchableOpacity>
        <TouchableOpacity style={f.doneBtn} onPress={onDismiss} activeOpacity={0.8}>
          <Text style={f.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={f.root}>
      <Text style={f.sectionLabel}>Payment Method</Text>
      <View style={f.methodRow}>
        {SETTLE_METHODS.map((m) => (
          <TouchableOpacity
            key={m.value}
            style={[f.methodBtn, method === m.value && f.methodBtnSel]}
            onPress={() => { setMethod(m.value); setCashReceived(''); setReference(''); }}
            activeOpacity={0.7}
          >
            <Text style={f.methodIcon}>{m.icon}</Text>
            <Text style={[f.methodLabel, method === m.value && f.methodLabelSel]}>
              {m.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {method === 'cash' && (
        <>
          <View style={f.amountBox}>
            <Text style={f.amountLabel}>Amount Due</Text>
            <Text style={f.amountValue}>₱{ceilTotal}</Text>
          </View>
          <Text style={f.sectionLabel}>Cash Received (₱)</Text>
          <TextInput
            style={[f.input, f.cashInput]}
            placeholder="0.00"
            placeholderTextColor={Colors.gray400}
            keyboardType="numeric"
            value={cashReceived}
            onChangeText={setCashReceived}
            returnKeyType="done"
          />
          {cashNum > 0 && cashNum < ceilTotal && (
            <View style={[f.changeBox, f.changeBoxShort]}>
              <Text style={f.changeLabelShort}>Short</Text>
              <Text style={f.changeAmtShort}>−₱{(ceilTotal - cashNum).toFixed(2)}</Text>
            </View>
          )}
          {cashNum >= ceilTotal && (
            <View style={f.changeBox}>
              <Text style={f.changeLabel}>Change</Text>
              <Text style={f.changeAmt}>₱{localChange.toFixed(2)}</Text>
            </View>
          )}
        </>
      )}

      {method !== 'cash' && (
        <>
          <Text style={f.sectionLabel}>Reference No. (optional)</Text>
          <TextInput
            style={f.input}
            placeholder="e.g. approval code, transaction ID"
            placeholderTextColor={Colors.gray400}
            value={reference}
            onChangeText={setReference}
            returnKeyType="done"
          />
        </>
      )}

      <TouchableOpacity
        style={[f.collectBtn, (!canSettle || settling) && f.btnOff]}
        onPress={handleSettle}
        disabled={!canSettle || settling}
        activeOpacity={0.8}
      >
        {settling
          ? <ActivityIndicator color={Colors.white} />
          : <Text style={f.collectBtnText}>Collect Payment</Text>
        }
      </TouchableOpacity>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PayLaterScreen({ route, navigation }: Props) {
  const { session } = route.params;

  const [orders,   setOrders]   = useState<Order[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [settling, setSettling] = useState<string | null>(null);
  const [error,    setError]    = useState('');
  const [settings, setSettings] = useState<Settings>({});

  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; });
  useEffect(() => {
    load();
    getSettings().then(setSettings).catch(() => {});
  }, []);

  async function load() {
    setLoading(true);
    try {
      setOrders(await getUnpaidOrdersBySession(session.id));
    } catch {
      setError('Could not load pay-later orders.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSettle(
    order:         Order,
    method:        SettleMethod,
    cashReceived?: number,
    reference?:    string,
  ) {
    setSettling(order.id);
    try {
      await settlePaylaterOrder(order.id, session.id, method, cashReceived, reference);
    } catch {
      setError('Failed to settle order. Please try again.');
    } finally {
      setSettling(null);
    }
  }

  const renderOrder = useCallback(({ item }: { item: Order }) => {
    const isOpen     = expanded === item.id;
    const isSettling = settling === item.id;
    const qty        = item.items.reduce((s, i) => s + i.quantity, 0);

    return (
      <View style={s.card}>
        {/* Collapsed header */}
        <TouchableOpacity
          style={s.cardRow}
          onPress={() => setExpanded(isOpen ? null : item.id)}
          activeOpacity={0.85}
        >
          <View style={s.cardLeft}>
            <View style={s.cardTitleRow}>
              <Text style={s.cardLabel}>{item.order_number}</Text>
              {item.customer_name ? (
                <View style={s.nameChip}>
                  <Text style={s.nameChipText}>{item.customer_name}</Text>
                </View>
              ) : null}
            </View>
            <Text style={s.cardMeta}>
              {fmtTime(item.created_at)} · {relativeTime(item.created_at)}
              {' · '}{qty} item{qty !== 1 ? 's' : ''}
              {' · '}{TYPE_LABELS[item.order_type] ?? item.order_type}
              {item.table_number ? ` · Table ${item.table_number}` : ''}
            </Text>
          </View>
          <View style={s.cardRight}>
            <Text style={s.cardTotal}>₱{item.total_amount.toFixed(2)}</Text>
            <View style={s.unpaidChip}>
              <Text style={s.unpaidChipText}>Unpaid</Text>
            </View>
          </View>
          <Text style={s.chevron}>{isOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {/* Expanded: 2-column layout */}
        {isOpen && (
          <View style={s.detail}>
            <View style={s.detailDivider} />
            <View style={s.detailColumns}>

              {/* Left column — order items */}
              <View style={s.detailLeft}>
                <Text style={s.colTitle}>Order Items</Text>
                {item.items.map((ci, idx) => (
                  <View key={idx} style={s.itemRow}>
                    <View style={s.itemInfo}>
                      <Text style={s.itemName}>{ci.product_name}</Text>
                      {ci.modifiers.length > 0 && (
                        <Text style={s.itemMods}>
                          {ci.modifiers.map((m) => m.modifier_name).join(', ')}
                        </Text>
                      )}
                      {!!ci.notes && <Text style={s.itemNote}>"{ci.notes}"</Text>}
                    </View>
                    <Text style={s.itemQty}>×{ci.quantity}</Text>
                    <Text style={s.itemPrice}>₱{(ci.unit_price * ci.quantity).toFixed(2)}</Text>
                  </View>
                ))}
                {item.discount_amount > 0 && (
                  <View style={[s.itemRow, s.discountRow]}>
                    <Text style={s.discountLabel}>Discount</Text>
                    <Text style={s.discountAmt}>−₱{item.discount_amount.toFixed(2)}</Text>
                  </View>
                )}
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Total Due</Text>
                  <Text style={s.totalAmt}>₱{item.total_amount.toFixed(2)}</Text>
                </View>
              </View>

              {/* Column divider */}
              <View style={s.colDivider} />

              {/* Right column — payment form */}
              <View style={s.detailRight}>
                <Text style={s.colTitle}>Payment</Text>
                <PayForm
                  order={item}
                  settling={isSettling}
                  settings={settings}
                  onSettle={(method, cashReceived, reference) =>
                    handleSettle(item, method, cashReceived, reference)
                  }
                  onDismiss={() => {
                    setOrders((prev) => prev.filter((o) => o.id !== item.id));
                    setExpanded(null);
                  }}
                />
              </View>

            </View>
          </View>
        )}
      </View>
    );
  }, [expanded, settling, settings]);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Pay Later</Text>
        {orders.length > 0 && (
          <View style={s.countBadge}>
            <Text style={s.countBadgeText}>{orders.length}</Text>
          </View>
        )}
        <TouchableOpacity
          style={[s.refreshBtn, loading && s.btnDisabled]}
          onPress={load}
          disabled={loading}
          activeOpacity={0.8}
        >
          <Text style={s.refreshBtnText}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {!!error && (
        <View style={s.errorBanner}>
          <Text style={s.errorBannerText}>{error}</Text>
          <TouchableOpacity onPress={() => setError('')}>
            <Text style={s.errorBannerDismiss}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.green600} />
        </View>
      ) : orders.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyIcon}>✓</Text>
          <Text style={s.emptyTitle}>No pending payments</Text>
          <Text style={s.emptySubtitle}>All pay-later orders have been settled.</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={s.listContent}
          renderItem={renderOrder}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />
      )}
    </View>
  );
}

// ─── Screen styles ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md,
    backgroundColor: Colors.green700,
  },
  backBtn:      { paddingVertical: Spacing.xs, paddingRight: Spacing.xs },
  backText:     { fontSize: FontSize.base, color: Colors.white, fontWeight: FontWeight.medium },
  title:        { flex: 1, fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.white },
  countBadge: {
    minWidth: 24, height: 24, borderRadius: 12,
    backgroundColor: Colors.warning, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countBadgeText: { fontSize: FontSize.xs, fontWeight: FontWeight.extrabold, color: Colors.white },
  refreshBtn: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    minWidth: 70, alignItems: 'center',
  },
  refreshBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.white },
  btnDisabled:    { opacity: 0.45 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.dangerBg, borderBottomWidth: 1,
    borderBottomColor: Colors.danger + '44',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  errorBannerText:    { flex: 1, fontSize: FontSize.sm, color: Colors.danger },
  errorBannerDismiss: { fontSize: FontSize.base, color: Colors.danger, fontWeight: FontWeight.bold },

  center:        { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, padding: Spacing.xxxl },
  emptyIcon:     { fontSize: 48, color: Colors.green600 },
  emptyTitle:    { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.gray700 },
  emptySubtitle: { fontSize: FontSize.base, color: Colors.gray400, textAlign: 'center' },

  listContent: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xxxl },

  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', ...Shadow.sm,
  },
  cardRow: {
    flexDirection: 'row', alignItems: 'center', padding: Spacing.lg, gap: Spacing.sm,
  },
  cardLeft:     { flex: 1 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  cardLabel:    { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.gray800 },
  nameChip: {
    paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.full,
    backgroundColor: Colors.green100,
  },
  nameChipText: { fontSize: FontSize.xs, fontWeight: FontWeight.bold, color: Colors.green700 },
  cardMeta:  { fontSize: FontSize.xs, color: Colors.gray500, marginTop: 3 },
  cardRight: { alignItems: 'flex-end', gap: Spacing.xs },
  cardTotal: { fontSize: FontSize.lg, fontWeight: FontWeight.extrabold, color: Colors.green700 },
  unpaidChip: {
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
    borderRadius: Radius.full, backgroundColor: Colors.warningBg,
  },
  unpaidChipText: { fontSize: FontSize.xs, color: Colors.warning, fontWeight: FontWeight.bold },
  chevron: { fontSize: FontSize.xs, color: Colors.gray400, marginLeft: Spacing.xs },

  // Expanded section
  detail: { borderTopWidth: 1, borderColor: Colors.border },
  detailDivider: { height: 0 },
  detailColumns: {
    flexDirection: 'row',
  },
  detailLeft: {
    flex: 1,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  colDivider: {
    width: 1,
    backgroundColor: Colors.border,
  },
  detailRight: {
    flex: 1,
    padding: Spacing.lg,
  },
  colTitle: {
    fontSize: FontSize.xs, fontWeight: FontWeight.semibold,
    color: Colors.gray400, textTransform: 'uppercase',
    letterSpacing: 0.5, marginBottom: Spacing.sm,
  },

  itemRow:   { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4, gap: Spacing.sm },
  itemInfo:  { flex: 1 },
  itemName:  { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },
  itemMods:  { fontSize: FontSize.xs, color: Colors.gray500, marginTop: 1 },
  itemNote:  { fontSize: FontSize.xs, color: Colors.info, fontStyle: 'italic' },
  itemQty:   { fontSize: FontSize.sm, color: Colors.gray500, minWidth: 28, textAlign: 'center' },
  itemPrice: {
    fontSize: FontSize.sm, fontWeight: FontWeight.semibold,
    color: Colors.gray800, minWidth: 64, textAlign: 'right',
  },
  discountRow: {
    borderTopWidth: 1, borderColor: Colors.border,
    marginTop: Spacing.xs, paddingTop: Spacing.xs, justifyContent: 'space-between',
  },
  discountLabel: { flex: 1, fontSize: FontSize.sm, color: Colors.danger, fontWeight: FontWeight.medium },
  discountAmt:   { fontSize: FontSize.sm, color: Colors.danger, fontWeight: FontWeight.bold },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderColor: Colors.border,
    marginTop: Spacing.sm, paddingTop: Spacing.sm,
  },
  totalLabel: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray600 },
  totalAmt:   { fontSize: FontSize.xl, fontWeight: FontWeight.extrabold, color: Colors.gray900 },
});

// ─── Pay form styles ──────────────────────────────────────────────────────────

const f = StyleSheet.create({
  root: { gap: Spacing.md },
  sectionLabel: {
    fontSize: FontSize.xs, fontWeight: FontWeight.semibold,
    color: Colors.gray500, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  methodBtn: {
    flex: 1, minWidth: isTablet ? 72 : '40%',
    alignItems: 'center', paddingVertical: Spacing.sm,
    borderRadius: Radius.md, borderWidth: 1.5,
    borderColor: Colors.border, backgroundColor: Colors.surface, gap: 4,
  },
  methodBtnSel:   { borderColor: Colors.green600, backgroundColor: Colors.green50 },
  methodIcon:     { fontSize: 16 },
  methodLabel:    { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.gray600 },
  methodLabelSel: { color: Colors.green700 },

  amountBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.gray800, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  amountLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray300 },
  amountValue: { fontSize: FontSize.xl, fontWeight: FontWeight.extrabold, color: Colors.white },

  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    fontSize: FontSize.base, color: Colors.gray800, backgroundColor: Colors.gray50,
  },
  cashInput: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold },

  changeBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.green50, borderRadius: Radius.md,
    padding: Spacing.sm, borderWidth: 1, borderColor: Colors.green200,
  },
  changeBoxShort:   { backgroundColor: Colors.dangerBg, borderColor: Colors.danger + '44' },
  changeLabel:      { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.green700 },
  changeLabelShort: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.danger },
  changeAmt:        { fontSize: FontSize.xl, fontWeight: FontWeight.extrabold, color: Colors.green700 },
  changeAmtShort:   { fontSize: FontSize.xl, fontWeight: FontWeight.extrabold, color: Colors.danger },

  collectBtn: {
    backgroundColor: Colors.green600, borderRadius: Radius.md,
    paddingVertical: Spacing.md, alignItems: 'center', ...Shadow.sm,
  },
  btnOff:         { opacity: 0.45 },
  collectBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.white },

  // Settled state
  settledRoot:  { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.lg },
  settledIcon:  { fontSize: 40, color: Colors.green600 },
  settledTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.green700 },
  printBtn: {
    width: '100%', backgroundColor: Colors.green600, borderRadius: Radius.md,
    paddingVertical: Spacing.md, alignItems: 'center',
  },
  printBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.white },
  doneBtn: {
    width: '100%', borderRadius: Radius.md, paddingVertical: Spacing.md,
    alignItems: 'center', borderWidth: 1.5, borderColor: Colors.border,
  },
  doneBtnText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray600 },
});
