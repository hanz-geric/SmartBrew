import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useShallow } from 'zustand/react/shallow';
import { CashierStackParamList } from '../../navigation/CashierStack';
import { useAuthStore } from '../../store/authStore';
import { useCartStore } from '../../store/cartStore';
import { createOrder, getSettings } from '../../firebase/firestoreService';
import { enqueueOrder } from '../../db/queries/queue';
import { syncPendingOrders } from '../../services/syncService';
import { buildKitchenTicket } from '../../utils/printerTemplates';
import { printBytes } from '../../services/printerService';
import {
  AuthUser, CartItem, CashSession, CheckoutPayload,
  Order, OrderItem, OrderType, PaymentMethod, Settings,
} from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing, isTablet,
} from '../../constants/theme';

type Props = NativeStackScreenProps<CashierStackParamList, 'Payment'>;

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: 'dine_in',  label: 'Dine In'  },
  { value: 'takeaway', label: 'Takeaway' },
  { value: 'delivery', label: 'Delivery' },
];

const PAY_METHODS: { value: PaymentMethod; label: string; icon: string }[] = [
  { value: 'cash',      label: 'Cash',      icon: '💵' },
  { value: 'card',      label: 'Card',      icon: '💳' },
  { value: 'qr',        label: 'QR',        icon: '📱' },
  { value: 'gift_card', label: 'Gift Card', icon: '🎁' },
];

// Build a local Order from a payload so receipt can display offline orders
function buildOfflineOrder(
  localId: string,
  payload: CheckoutPayload,
  session: CashSession,
  user:    AuthUser,
): Order {
  const now            = new Date().toISOString();
  const subtotal       = payload.cart_snapshot.reduce(
    (s, i) => s + i.unit_price * i.quantity, 0,
  );
  const discountAmount = payload.discount_amount ?? 0;
  const profitAmount   = payload.cart_snapshot.reduce(
    (s, i) => s + (i.unit_price - i.unit_cost) * i.quantity, 0,
  );
  const items: OrderItem[] = payload.cart_snapshot.map((i: CartItem) => ({
    product_id:   i.product_id,
    product_name: i.name,
    unit_price:   i.unit_price,
    unit_cost:    i.unit_cost,
    quantity:     i.quantity,
    subtotal:     i.unit_price * i.quantity,
    notes:        i.notes || null,
    modifiers:    i.modifiers,
  }));
  return {
    id:              localId,
    order_number:    `OFFLINE-${localId.slice(-6).toUpperCase()}`,
    user_id:         user.uid,
    cashier_name:    user.full_name || user.username,
    subtotal,
    discount_amount: discountAmount,
    total_amount:    subtotal - discountAmount,
    profit_amount:   profitAmount,
    payment_method:  payload.payment_method,
    payment_status:  'paid',
    status:          'completed',
    order_type:      payload.order_type,
    table_number:    payload.table_number ?? null,
    session_id:      session.id,
    created_at:      now,
    completed_at:    now,
    items,
  };
}

function quickAmounts(ceilTotal: number): number[] {
  const tens     = Math.ceil(ceilTotal / 10)  * 10;
  const fifties  = Math.ceil(ceilTotal / 50)  * 50;
  const hundreds = Math.ceil(ceilTotal / 100) * 100;
  const set = new Set([tens, fifties, hundreds].filter((v) => v > ceilTotal));
  return [...set].slice(0, 3);
}

export default function PaymentScreen({ route, navigation }: Props) {
  const { session, total, discountAmount, discountNonce } = route.params;
  const user      = useAuthStore((s) => s.user)!;
  const cartItems = useCartStore(useShallow((s) => Object.values(s.items)));
  const clearCart = useCartStore((s) => s.clearCart);
  const subtotal  = total + (discountAmount ?? 0);

  const [orderType,    setOrderType]    = useState<OrderType>('dine_in');
  const [tableNumber,  setTableNumber]  = useState('');
  const [payMethod,    setPayMethod]    = useState<PaymentMethod>('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [reference,    setReference]   = useState('');
  const [submitting,   setSubmitting]  = useState(false);
  const [error,        setError]       = useState('');
  const [settings,     setSettings]    = useState<Settings>({});

  useEffect(() => {
    getSettings().then(setSettings).catch(() => {});
  }, []);

  const ceilTotal = Math.ceil(total);
  const cashNum   = parseFloat(cashReceived) || 0;
  const change    = payMethod === 'cash'
    ? parseFloat(Math.max(0, cashNum - ceilTotal).toFixed(2))
    : 0;
  const canPay    =
    payMethod !== 'cash'
      ? true
      : cashNum >= ceilTotal;

  async function handleConfirm() {
    if (payMethod === 'cash' && cashNum < ceilTotal) {
      setError('Cash received is less than total.');
      return;
    }
    setSubmitting(true);
    setError('');

    const payload: CheckoutPayload = {
      payment_method:      payMethod,
      order_type:          orderType,
      table_number:        orderType === 'dine_in' ? tableNumber || undefined : undefined,
      cash_received:       payMethod === 'cash' ? cashNum : undefined,
      reference_number:    reference || undefined,
      discount_amount:     discountAmount,
      discount_auth_nonce: discountNonce,
      cart_snapshot:       cartItems,
    };

    let order: Order;
    let warnings: string[] = [];

    try {
      order = await createOrder(payload, session, user);
      syncPendingOrders(session, user).catch(() => {});

      // Fire kitchen ticket if any item needs it — non-blocking, failures are silent
      const needsKitchen = cartItems.some((i) => i.needs_kitchen);
      if (needsKitchen) {
        const kitchenBytes = buildKitchenTicket(order, settings);
        printBytes(kitchenBytes, {
          type:     (settings.kitchen_printer_type ?? 'wifi') as 'wifi' | 'bluetooth',
          ip:       settings.kitchen_printer_ip,
          port:     settings.kitchen_printer_port,
          btDevice: settings.kitchen_printer_bt,
        }).catch(() => {});
      }
    } catch {
      // Network unavailable — queue locally
      try {
        const localId = await enqueueOrder(payload);
        order    = buildOfflineOrder(localId, payload, session, user);
        warnings = ['Order saved offline — will sync when connected.'];
      } catch (queueErr) {
        setError('Failed to save order. Try again.');
        setSubmitting(false);
        return;
      }
    }

    clearCart();
    navigation.replace('Receipt', {
      order,
      change,
      printWarnings: warnings,
      session,
    });
  }

  return (
    <View style={s.root}>
      {/* ── Left: Order Summary ── */}
      <View style={s.left}>
        <View style={s.panelHeader}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Text style={s.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.panelTitle}>Order Summary</Text>
        </View>

        <FlatList
          data={cartItems}
          keyExtractor={(i) => i.cart_key}
          contentContainerStyle={s.summaryList}
          renderItem={({ item }) => (
            <View style={s.summaryRow}>
              <View style={s.summaryInfo}>
                <Text style={s.summaryName}>{item.name}</Text>
                {item.modifiers.length > 0 && (
                  <Text style={s.summaryMods}>
                    {item.modifiers.map((m) => m.modifier_name).join(', ')}
                  </Text>
                )}
                {!!item.notes && (
                  <Text style={s.summaryNote}>"{item.notes}"</Text>
                )}
              </View>
              <Text style={s.summaryQty}>×{item.quantity}</Text>
              <Text style={s.summaryPrice}>
                ₱{(item.unit_price * item.quantity).toFixed(2)}
              </Text>
            </View>
          )}
          ListFooterComponent={
            <View style={s.summaryFooter}>
              {discountAmount ? (
                <>
                  <View style={s.summaryTotalRow}>
                    <Text style={s.summarySubLabel}>Subtotal</Text>
                    <Text style={s.summarySub}>₱{subtotal.toFixed(2)}</Text>
                  </View>
                  <View style={s.summaryTotalRow}>
                    <Text style={s.summaryDiscountLabel}>Discount</Text>
                    <Text style={s.summaryDiscount}>−₱{discountAmount.toFixed(2)}</Text>
                  </View>
                  <View style={[s.summaryTotalRow, { marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderColor: Colors.gray200 }]}>
                    <Text style={s.summaryTotalLabel}>Total</Text>
                    <Text style={s.summaryTotal}>₱{total.toFixed(2)}</Text>
                  </View>
                </>
              ) : (
                <View style={s.summaryTotalRow}>
                  <Text style={s.summaryTotalLabel}>Total</Text>
                  <Text style={s.summaryTotal}>₱{total.toFixed(2)}</Text>
                </View>
              )}
            </View>
          }
        />
      </View>

      {/* ── Right: Payment Form ── */}
      <ScrollView style={s.right} contentContainerStyle={s.rightContent} keyboardShouldPersistTaps="handled">
        <Text style={s.sectionTitle}>Order Type</Text>
        <View style={s.radioGroup}>
          {ORDER_TYPES.map((t) => (
            <TouchableOpacity
              key={t.value}
              style={[s.radioBtn, orderType === t.value && s.radioBtnSel]}
              onPress={() => setOrderType(t.value)}
              activeOpacity={0.7}
            >
              <Text style={[s.radioBtnText, orderType === t.value && s.radioBtnTextSel]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {orderType === 'dine_in' && (
          <>
            <Text style={s.sectionTitle}>Table Number</Text>
            <TextInput
              style={s.input}
              placeholder="e.g. T1, T2, Bar"
              placeholderTextColor={Colors.gray400}
              value={tableNumber}
              onChangeText={setTableNumber}
              returnKeyType="done"
            />
          </>
        )}

        <Text style={s.sectionTitle}>Payment Method</Text>
        <View style={s.methodGrid}>
          {PAY_METHODS.map((m) => (
            <TouchableOpacity
              key={m.value}
              style={[s.methodCard, payMethod === m.value && s.methodCardSel]}
              onPress={() => { setPayMethod(m.value); setCashReceived(''); setReference(''); }}
              activeOpacity={0.7}
            >
              <Text style={s.methodIcon}>{m.icon}</Text>
              <Text style={[s.methodLabel, payMethod === m.value && s.methodLabelSel]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Cash details */}
        {payMethod === 'cash' && (
          <>
            <View style={s.amountDueBox}>
              <Text style={s.amountDueLabel}>Amount Due</Text>
              <Text style={s.amountDueValue}>₱{ceilTotal}</Text>
            </View>
            <Text style={s.sectionTitle}>Cash Received (₱)</Text>
            <TextInput
              style={[s.input, s.cashInput]}
              placeholder="0.00"
              placeholderTextColor={Colors.gray400}
              keyboardType="numeric"
              value={cashReceived}
              onChangeText={(t) => { setCashReceived(t); setError(''); }}
              returnKeyType="done"
            />
            {/* Quick amount buttons */}
            <View style={s.quickRow}>
              <TouchableOpacity
                style={s.quickBtn}
                onPress={() => setCashReceived(String(ceilTotal))}
              >
                <Text style={s.quickBtnText}>Exact</Text>
              </TouchableOpacity>
              {quickAmounts(ceilTotal).map((amt) => (
                <TouchableOpacity
                  key={amt}
                  style={s.quickBtn}
                  onPress={() => setCashReceived(String(amt))}
                >
                  <Text style={s.quickBtnText}>₱{amt.toLocaleString()}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {cashNum > 0 && cashNum < ceilTotal && (
              <View style={[s.changeBox, s.changeBoxShort]}>
                <Text style={s.changeLabelShort}>Short</Text>
                <Text style={s.changeAmountShort}>−₱{(ceilTotal - cashNum).toFixed(2)}</Text>
              </View>
            )}
            {cashNum >= ceilTotal && (
              <View style={s.changeBox}>
                <Text style={s.changeLabel}>Change</Text>
                <Text style={s.changeAmount}>₱{change.toFixed(2)}</Text>
              </View>
            )}
          </>
        )}

        {/* Card / QR / Gift Card reference */}
        {payMethod !== 'cash' && (
          <>
            <Text style={s.sectionTitle}>
              Reference No.{payMethod !== 'gift_card' ? ' (optional)' : ''}
            </Text>
            <TextInput
              style={s.input}
              placeholder="e.g. approval code, transaction ID"
              placeholderTextColor={Colors.gray400}
              value={reference}
              onChangeText={setReference}
              returnKeyType="done"
            />
          </>
        )}

        {!!error && <Text style={s.error}>{error}</Text>}

        {/* Total + Confirm */}
        <View style={s.confirmSection}>
          <View style={s.confirmTotal}>
            <Text style={s.confirmTotalLabel}>
              {discountAmount ? 'Total (after discount)' : 'Total'}
            </Text>
            <Text style={s.confirmTotalAmt}>₱{total.toFixed(2)}</Text>
          </View>
          <TouchableOpacity
            style={[s.confirmBtn, (!canPay || submitting) && s.confirmBtnOff]}
            onPress={handleConfirm}
            disabled={!canPay || submitting}
            activeOpacity={0.8}
          >
            {submitting
              ? <ActivityIndicator color={Colors.white} />
              : <Text style={s.confirmBtnText}>Confirm Payment</Text>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: Colors.background,
  },

  // Left panel
  left: {
    flex: 1,
    maxWidth: isTablet ? 600 : undefined,
    borderRightWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.green700,
  },
  backBtn: {
    paddingVertical: Spacing.xs,
  },
  backText: {
    fontSize: FontSize.base,
    color: Colors.white,
    fontWeight: FontWeight.medium,
  },
  panelTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
  summaryList: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderColor: Colors.gray100,
  },
  summaryInfo: { flex: 1 },
  summaryName: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray800,
  },
  summaryMods: {
    fontSize: FontSize.xs,
    color: Colors.gray500,
    marginTop: 1,
  },
  summaryNote: {
    fontSize: FontSize.xs,
    color: Colors.info,
    fontStyle: 'italic',
  },
  summaryQty: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
    minWidth: 28,
    textAlign: 'center',
  },
  summaryPrice: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray800,
    minWidth: 64,
    textAlign: 'right',
  },
  summaryFooter: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 2,
    borderColor: Colors.gray200,
  },
  summaryTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summarySubLabel:     { fontSize: FontSize.sm, color: Colors.gray500 },
  summarySub:          { fontSize: FontSize.sm, color: Colors.gray500 },
  summaryDiscountLabel:{ fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.danger },
  summaryDiscount:     { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.danger },
  summaryTotalLabel: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.gray600,
  },
  summaryTotal: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.extrabold,
    color: Colors.gray900,
  },

  // Right panel
  right: {
    flex: 1,
    maxWidth: isTablet ? 600 : undefined,
    backgroundColor: Colors.surface,
  },
  rightContent: {
    padding: Spacing.xl,
    gap: Spacing.md,
    paddingBottom: Spacing.xxxl,
  },
  sectionTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: Spacing.sm,
  },

  radioGroup: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  radioBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  radioBtnSel: {
    borderColor: Colors.green600,
    backgroundColor: Colors.green50,
  },
  radioBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.gray600,
  },
  radioBtnTextSel: {
    color: Colors.green700,
    fontWeight: FontWeight.bold,
  },

  methodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  methodCard: {
    flex: 1,
    minWidth: '40%',
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  methodCardSel: {
    borderColor: Colors.green600,
    backgroundColor: Colors.green50,
  },
  methodIcon: { fontSize: 22 },
  methodLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.gray600,
  },
  methodLabelSel: {
    color: Colors.green700,
  },

  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: FontSize.base,
    color: Colors.gray800,
    backgroundColor: Colors.gray50,
  },
  cashInput: {
    fontSize: FontSize.xxxl,
    fontWeight: FontWeight.bold,
  },

  quickRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  quickBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.gray100,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quickBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.gray700,
  },

  amountDueBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.gray800,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  amountDueLabel: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray300,
  },
  amountDueValue: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.extrabold,
    color: Colors.white,
  },
  changeBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.green50,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.green200,
  },
  changeBoxShort: {
    backgroundColor: Colors.dangerBg,
    borderColor: Colors.danger + '44',
  },
  changeLabel: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.green700,
  },
  changeLabelShort: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.danger,
  },
  changeAmount: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.extrabold,
    color: Colors.green700,
  },
  changeAmountShort: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.extrabold,
    color: Colors.danger,
  },

  error: {
    fontSize: FontSize.sm,
    color: Colors.danger,
  },

  confirmSection: {
    gap: Spacing.md,
    marginTop: Spacing.md,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderColor: Colors.border,
  },
  confirmTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  confirmTotalLabel: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.gray600,
  },
  confirmTotalAmt: {
    fontSize: FontSize.display,
    fontWeight: FontWeight.extrabold,
    color: Colors.gray900,
  },
  confirmBtn: {
    backgroundColor: Colors.green600,
    borderRadius: Radius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    ...Shadow.md,
  },
  confirmBtnOff: {
    backgroundColor: Colors.gray300,
    ...Shadow.sm,
  },
  confirmBtnText: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
});
