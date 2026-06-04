import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useToast } from '../../components/ui';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CashierStackParamList } from '../../navigation/CashierStack';
import { useCartStore } from '../../store/cartStore';
import { getSettings } from '../../firebase/firestoreService';
import { buildReceipt } from '../../utils/printerTemplates';
import { printBytes } from '../../services/printerService';
import { Settings } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing, isTablet,
} from '../../constants/theme';

type Props = NativeStackScreenProps<CashierStackParamList, 'Receipt'>;

const PAY_LABELS: Record<string, string> = {
  cash:      'Cash',
  card:      'Card',
  qr:        'QR',
  gift_card: 'Gift Card',
  pay_later: 'Pay Later',
};

const TYPE_LABELS: Record<string, string> = {
  dine_in:  'Dine In',
  takeaway: 'Takeaway',
  delivery: 'Delivery',
};

export default function ReceiptScreen({ route, navigation }: Props) {
  const { order, change, session, printWarnings } = route.params;
  const clearCart = useCartStore((s) => s.clearCart);
  const toast = useToast();

  const [settings,  setSettings]  = useState<Settings>({});
  const [printing,  setPrinting]  = useState(false);

  useEffect(() => {
    getSettings().then(setSettings).catch(() => {});
  }, []);

  function handleNewOrder() {
    clearCart();
    navigation.replace('POS', { session });
  }

  async function handlePrint() {
    setPrinting(true);
    try {
      // Cash sales pop the drawer; card/QR/gift-card receipts print without it.
      const openDrawer = order.payment_method === 'cash';
      const bytes = buildReceipt(order, change, settings, openDrawer);
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

  const dateStr = new Date(order.created_at).toLocaleString('en-PH', {
    month:  'short',
    day:    'numeric',
    year:   'numeric',
    hour:   'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <View style={s.root}>
      {/* ── Receipt Panel ── */}
      <ScrollView
        style={s.receipt}
        contentContainerStyle={s.receiptContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Offline warning banner */}
        {(printWarnings ?? []).map((w, i) => (
          <View key={i} style={s.warnBanner}>
            <Text style={s.warnText}>⚠ {w}</Text>
          </View>
        ))}

        {/* Header */}
        <View style={s.receiptHeader}>
          <Image
            source={require('../../../assets/images/SmartBrew_logo.jpg')}
            style={s.receiptLogo}
            resizeMode="contain"
          />
          <Text style={s.shopName}>SmartBrew POS</Text>
          <Text style={s.orderNum}>Order #{order.order_number}</Text>
          <Text style={s.dateText}>{dateStr}</Text>
          <View style={s.typeBadge}>
            <Text style={s.typeBadgeText}>{TYPE_LABELS[order.order_type] ?? order.order_type}</Text>
          </View>
          {order.customer_name ? (
            <Text style={s.tableText}>Customer: {order.customer_name}</Text>
          ) : null}
          {order.table_number && (
            <Text style={s.tableText}>Table: {order.table_number}</Text>
          )}
        </View>

        {/* Items */}
        <View style={s.divider} />
        {order.items.map((item, idx) => (
          <View key={idx} style={s.itemRow}>
            <View style={s.itemInfo}>
              <Text style={s.itemName}>{item.product_name}</Text>
              {item.modifiers.length > 0 && (
                <Text style={s.itemMods}>
                  {item.modifiers.map((m) => m.modifier_name).join(', ')}
                </Text>
              )}
              {!!item.notes && (
                <Text style={s.itemNote}>"{item.notes}"</Text>
              )}
            </View>
            <Text style={s.itemQty}>×{item.quantity}</Text>
            <Text style={s.itemPrice}>₱{item.subtotal.toFixed(2)}</Text>
          </View>
        ))}

        {/* Totals */}
        <View style={s.divider} />
        <View style={s.totalsSection}>
          <View style={s.totalsRow}>
            <Text style={s.totalsLabel}>Subtotal</Text>
            <Text style={s.totalsValue}>₱{order.subtotal.toFixed(2)}</Text>
          </View>
          {order.discount_amount > 0 && (
            <View style={s.totalsRow}>
              <Text style={s.totalsLabel}>Discount</Text>
              <Text style={[s.totalsValue, s.discount]}>
                −₱{order.discount_amount.toFixed(2)}
              </Text>
            </View>
          )}
          <View style={[s.totalsRow, s.totalRow]}>
            <Text style={s.totalLabel}>Total</Text>
            <Text style={s.totalAmt}>₱{order.total_amount.toFixed(2)}</Text>
          </View>
        </View>

        {/* Payment info */}
        <View style={s.divider} />
        <View style={s.paySection}>
          <View style={s.totalsRow}>
            <Text style={s.totalsLabel}>Payment</Text>
            <Text style={[
              s.totalsValue,
              order.payment_status === 'unpaid' && { color: Colors.warning },
            ]}>
              {PAY_LABELS[order.payment_method] ?? order.payment_method}
              {order.payment_status === 'unpaid' ? ' (pending)' : ''}
            </Text>
          </View>
          {order.payment_method === 'cash' && change > 0 && (
            <View style={s.changeBox}>
              <Text style={s.changeLabel}>Change</Text>
              <Text style={s.changeAmt}>₱{change.toFixed(2)}</Text>
            </View>
          )}
          <View style={s.totalsRow}>
            <Text style={s.totalsLabel}>Cashier</Text>
            <Text style={s.totalsValue}>{order.cashier_name}</Text>
          </View>
        </View>

        <View style={s.divider} />
        <Text style={s.footer}>Thank you for visiting SmartBrew!</Text>
      </ScrollView>

      {/* ── Actions ── */}
      <View style={s.actions}>
        {order.payment_status === 'unpaid'
          ? <Text style={[s.successBanner, s.pendingBanner]}>🕐 Payment Pending</Text>
          : <Text style={s.successBanner}>✓ Order Completed</Text>
        }

        <TouchableOpacity style={s.newOrderBtn} onPress={handleNewOrder} activeOpacity={0.8}>
          <Text style={s.newOrderText}>New Order</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.printBtn, printing && s.printBtnOff]}
          onPress={handlePrint}
          disabled={printing}
          activeOpacity={0.8}
        >
          {printing
            ? <ActivityIndicator color={Colors.gray700} size="small" />
            : <Text style={s.printBtnText}>🖨️ Print Receipt</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={s.sessionBtn}
          onPress={() => navigation.navigate('CloseSession', { session })}
          activeOpacity={0.8}
        >
          <Text style={s.sessionBtnText}>End Shift</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: Colors.background,
  },

  // Receipt scroll
  receipt: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRightWidth: 1,
    borderColor: Colors.border,
  },
  receiptContent: {
    padding: Spacing.xxl,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  receiptHeader: {
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
  },
  receiptLogo: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignSelf: 'center',
    marginBottom: Spacing.xs,
  },
  shopName: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.green700,
  },
  orderNum: {
    fontSize: FontSize.xxxl,
    fontWeight: FontWeight.extrabold,
    color: Colors.gray900,
    marginTop: Spacing.xs,
  },
  dateText: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
  },
  typeBadge: {
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    backgroundColor: Colors.green100,
  },
  typeBadgeText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.green800,
  },
  tableText: {
    fontSize: FontSize.sm,
    color: Colors.gray600,
    fontWeight: FontWeight.medium,
  },

  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.md,
  },

  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  itemInfo: { flex: 1 },
  itemName: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray800,
  },
  itemMods: {
    fontSize: FontSize.xs,
    color: Colors.gray500,
  },
  itemNote: {
    fontSize: FontSize.xs,
    color: Colors.info,
    fontStyle: 'italic',
  },
  itemQty: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
    minWidth: 28,
    textAlign: 'center',
  },
  itemPrice: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray800,
    minWidth: 72,
    textAlign: 'right',
  },

  totalsSection: { gap: Spacing.xs },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalsLabel: {
    fontSize: FontSize.base,
    color: Colors.gray600,
  },
  totalsValue: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray800,
  },
  discount: {
    color: Colors.danger,
  },
  totalRow: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderColor: Colors.gray200,
  },
  totalLabel: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.gray700,
  },
  totalAmt: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.extrabold,
    color: Colors.gray900,
  },

  paySection: { gap: Spacing.sm },
  changeBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.green50,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.green200,
  },
  changeLabel: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.green700,
  },
  changeAmt: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.extrabold,
    color: Colors.green700,
  },

  footer: {
    textAlign: 'center',
    fontSize: FontSize.sm,
    color: Colors.gray400,
    marginTop: Spacing.lg,
    fontStyle: 'italic',
  },
  warnBanner: {
    backgroundColor: Colors.warningBg,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  warnText: {
    fontSize: FontSize.sm,
    color: Colors.warning,
    fontWeight: FontWeight.semibold,
    textAlign: 'center',
  },

  // Actions panel
  actions: {
    width: isTablet ? 360 : undefined,
    flex: isTablet ? 0 : 1,
    maxWidth: isTablet ? 360 : '50%',
    backgroundColor: Colors.surface,
    padding: Spacing.xxl,
    justifyContent: 'center',
    gap: Spacing.lg,
    ...Shadow.lg,
  },
  successBanner: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.green700,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  pendingBanner: {
    color: Colors.warning,
  },
  newOrderBtn: {
    backgroundColor: Colors.green600,
    borderRadius: Radius.md,
    paddingVertical: Spacing.xl,
    alignItems: 'center',
    ...Shadow.md,
  },
  newOrderText: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
  printBtn: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.gray300,
    backgroundColor: Colors.surface,
  },
  printBtnOff:  { opacity: 0.6 },
  printBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray700,
  },
  sessionBtn: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.gray300,
    backgroundColor: Colors.surface,
  },
  sessionBtnText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray600,
  },
});
