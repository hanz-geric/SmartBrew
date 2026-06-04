import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Modal, RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { AppModal, PinKeypad, UsernameDropdown, useToast } from '../../components/ui';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CashierStackParamList } from '../../navigation/CashierStack';
import { getOrdersBySession, getSettings, voidOrder } from '../../firebase/firestoreService';
import { verifyManagerAuth } from '../../firebase/auth';
import { buildReceipt } from '../../utils/printerTemplates';
import { printBytes } from '../../services/printerService';
import { useAuthStore } from '../../store/authStore';
import { useNetwork } from '../../context/NetworkContext';
import { Order, Settings } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

type Props = NativeStackScreenProps<CashierStackParamList, 'SessionOrders'>;

const PAY_LABELS: Record<string, string> = {
  cash:      'Cash',
  card:      'Card',
  qr:        'QR',
  gift_card: 'Gift Card',
  pay_later: 'Pay Later',
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PH', {
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

const MAX_OVERRIDE_ATTEMPTS = 3;

export default function SessionOrdersScreen({ route, navigation }: Props) {
  const { session } = route.params;
  const toast       = useToast();
  const currentUser = useAuthStore((s) => s.user)!;
  const { isOnline } = useNetwork();

  const [orders,     setOrders]     = useState<Order[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState('');
  const [settings,   setSettings]   = useState<Settings>({});
  const [reprinting, setReprinting] = useState<string | null>(null);

  // Void state
  const [voidTarget,        setVoidTarget]        = useState<Order | null>(null);
  const [voiding,           setVoiding]           = useState<string | null>(null);
  const [showOverride,      setShowOverride]       = useState(false);
  const [overrideUsername,  setOverrideUsername]  = useState('');
  const [overridePin,       setOverridePin]       = useState('');
  const [overrideError,     setOverrideError]     = useState('');
  const [overrideVerifying, setOverrideVerifying] = useState(false);
  const overrideAttempts = useRef(0);

  useEffect(() => {
    getSettings().then(setSettings).catch(() => {});
    load();
  }, []);

  async function load(fromRefresh = false) {
    if (fromRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const list = await getOrdersBySession(session.id);
      setOrders([...list].reverse()); // newest first
    } catch {
      setError('Failed to load orders.');
    } finally {
      setLoading(false);
      setRefreshing(false);
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
    } catch (e: unknown) {
      toast.error((e as Error).message ?? 'Could not reach printer.');
    } finally {
      setReprinting(null);
    }
  }

  function handleVoidPress(order: Order) {
    setVoidTarget(order);
    if (currentUser.role === 'cashier') {
      overrideAttempts.current = 0;
      setOverrideUsername('');
      setOverridePin('');
      setOverrideError('');
      setShowOverride(true);
    }
  }

  function closeOverride() {
    setShowOverride(false);
    setVoidTarget(null);
  }

  async function handleOverrideSubmit(completedPin?: string) {
    if (!voidTarget) return;
    const pwd = completedPin ?? overridePin;
    setOverrideError('');
    if (!overrideUsername.trim() || pwd.length < 6) {
      setOverrideError('Enter username and 6-digit PIN.');
      setOverridePin('');
      return;
    }
    setOverrideVerifying(true);
    try {
      await verifyManagerAuth(overrideUsername.trim(), pwd, isOnline);
      const id = voidTarget.id;
      setShowOverride(false);
      setVoidTarget(null);
      doVoid(id);
    } catch (e: unknown) {
      overrideAttempts.current += 1;
      if (overrideAttempts.current >= MAX_OVERRIDE_ATTEMPTS) {
        closeOverride();
        toast.error('Too many failed attempts.');
        return;
      }
      setOverrideError(
        `${(e as Error).message || 'Verification failed.'} (${overrideAttempts.current}/${MAX_OVERRIDE_ATTEMPTS})`,
      );
      setOverridePin('');
    } finally {
      setOverrideVerifying(false);
    }
  }

  async function doVoid(orderId: string) {
    setVoiding(orderId);
    try {
      await voidOrder(orderId);
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, status: 'cancelled', payment_status: 'unpaid' } : o,
        ),
      );
      toast.success('Order voided');
    } catch {
      toast.error('Failed to void order. Check your connection.');
    } finally {
      setVoiding(null);
    }
  }

  const activeOrders = orders.filter((o) => o.status !== 'cancelled');
  const revenue      = activeOrders.reduce((sum, o) => sum + o.total_amount, 0);

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.title}>Session Orders</Text>
          {!loading && !error && (
            <Text style={s.subtitle}>
              {activeOrders.length} order{activeOrders.length !== 1 ? 's' : ''}
              {' · '}₱{revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={s.refreshBtn}
          onPress={() => load(true)}
          disabled={loading || refreshing}
          activeOpacity={0.7}
        >
          <Text style={s.refreshText}>{(loading || refreshing) ? '…' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
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
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={[Colors.green600]}
            />
          }
          ListEmptyComponent={
            <Text style={s.empty}>No orders in this session yet.</Text>
          }
          renderItem={({ item: order }) => {
            const isVoided     = order.status === 'cancelled';
            const isReprinting = reprinting === order.id;
            const isVoiding    = voiding === order.id;

            return (
              <View style={[s.card, isVoided && s.cardVoided]}>
                <View style={s.cardRow}>
                  <View style={s.cardLeft}>
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
                    <Text style={s.meta}>
                      {fmtTime(order.created_at)}
                      {' · '}{PAY_LABELS[order.payment_method] ?? order.payment_method}
                    </Text>
                    <Text style={s.itemsSummary} numberOfLines={1}>
                      {order.items.map((i) => `${i.quantity}× ${i.product_name}`).join(', ')}
                    </Text>
                  </View>
                  <View style={s.cardRight}>
                    <Text style={[s.total, isVoided && s.totalVoided]}>
                      ₱{order.total_amount.toFixed(2)}
                    </Text>
                    <TouchableOpacity
                      style={[s.reprintBtn, (isVoided || !!reprinting) && s.reprintBtnOff]}
                      onPress={() => handleReprint(order)}
                      disabled={isVoided || !!reprinting}
                      activeOpacity={0.7}
                    >
                      {isReprinting
                        ? <ActivityIndicator size="small" color={Colors.green700} />
                        : <Text style={s.reprintText}>Reprint</Text>
                      }
                    </TouchableOpacity>
                    {!isVoided && (
                      <TouchableOpacity
                        style={[s.voidBtn, (!!voiding) && s.voidBtnOff]}
                        onPress={() => handleVoidPress(order)}
                        disabled={!!voiding}
                        activeOpacity={0.7}
                      >
                        {isVoiding
                          ? <ActivityIndicator size="small" color={Colors.danger} />
                          : <Text style={s.voidBtnText}>Void</Text>
                        }
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Admin/manager direct confirm */}
      {voidTarget && !showOverride && (
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

      {/* Cashier manager-override void modal */}
      {showOverride && voidTarget && (
        <Modal
          transparent
          animationType="fade"
          visible
          onRequestClose={closeOverride}
        >
          <View style={s.overlayBg}>
            <View style={[s.overrideCard, { maxHeight: '90%' }]}>
              <ScrollView
                bounces={false}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={s.overrideTitle}>Manager Authorisation</Text>
                <Text style={s.overrideSubtitle}>
                  A manager or admin must approve voiding order #{voidTarget.order_number}.
                </Text>

                <Text style={s.overrideLabel}>Username</Text>
                <UsernameDropdown
                  value={overrideUsername}
                  onChange={(u) => { setOverrideUsername(u); setOverridePin(''); }}
                  roles={['manager', 'admin']}
                  disabled={overrideVerifying}
                  placeholder="Select manager"
                />

                <Text style={s.overrideLabel}>PIN</Text>
                <PinKeypad
                  pin={overridePin}
                  onChange={setOverridePin}
                  onComplete={handleOverrideSubmit}
                  disabled={overrideVerifying}
                />

                {!!overrideError && (
                  <Text style={[s.overrideError, { marginTop: Spacing.sm }]}>{overrideError}</Text>
                )}

                <View style={s.overrideBtnRow}>
                  <TouchableOpacity
                    style={s.overrideCancelBtn}
                    onPress={closeOverride}
                    disabled={overrideVerifying}
                    activeOpacity={0.7}
                  >
                    <Text style={s.overrideCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.overrideConfirmBtn, (overrideVerifying || overridePin.length < 6) && s.overrideBtnOff]}
                    onPress={() => handleOverrideSubmit()}
                    disabled={overrideVerifying || overridePin.length < 6}
                    activeOpacity={0.7}
                  >
                    {overrideVerifying
                      ? <ActivityIndicator size="small" color={Colors.white} />
                      : <Text style={s.overrideConfirmText}>Void Order</Text>
                    }
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
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
    backgroundColor: Colors.green700,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  backBtn: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  backText: {
    fontSize: FontSize.base,
    color: Colors.white,
    fontWeight: FontWeight.semibold,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
  subtitle: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 2,
  },
  refreshBtn: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  refreshText: {
    fontSize: FontSize.lg,
    color: Colors.white,
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
  errorText: {
    color: Colors.danger,
    fontSize: FontSize.base,
    textAlign: 'center',
  },

  list: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  empty: {
    textAlign: 'center',
    color: Colors.gray400,
    fontSize: FontSize.base,
    paddingVertical: Spacing.xxxl,
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    ...Shadow.sm,
  },
  cardVoided: {
    opacity: 0.55,
    borderColor: Colors.gray200,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  cardLeft: {
    flex: 1,
    gap: 3,
  },
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
  meta: {
    fontSize: FontSize.xs,
    color: Colors.gray500,
  },
  itemsSummary: {
    fontSize: FontSize.xs,
    color: Colors.gray400,
  },

  cardRight: {
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  total: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.extrabold,
    color: Colors.green700,
  },
  totalVoided: {
    color: Colors.gray400,
    textDecorationLine: 'line-through',
  },
  reprintBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.green600,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
  },
  reprintBtnOff: {
    borderColor: Colors.gray300,
    opacity: 0.45,
  },
  reprintText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.green700,
  },

  voidBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.danger,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
  },
  voidBtnOff: {
    borderColor: Colors.gray300,
    opacity: 0.45,
  },
  voidBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.danger,
  },

  // Override modal
  overlayBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  overrideCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    ...Shadow.lg,
  },
  overrideTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.gray900,
    marginBottom: Spacing.xs,
  },
  overrideSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
    marginBottom: Spacing.lg,
    lineHeight: 20,
  },
  overrideLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.gray700,
    marginBottom: Spacing.xs,
  },
  overrideError: {
    fontSize: FontSize.sm,
    color: Colors.danger,
    marginBottom: Spacing.sm,
  },
  overrideBtnRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  overrideCancelBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  overrideCancelText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray600,
  },
  overrideConfirmBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.danger,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  overrideBtnOff: {
    opacity: 0.6,
  },
  overrideConfirmText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
});
