import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CashierStackParamList } from '../../navigation/CashierStack';
import { closeSession, getSession, clockOutAllActiveCashiers } from '../../firebase/firestoreService';
import { logout } from '../../firebase/auth';
import { useAuthStore } from '../../store/authStore';
import { useCartStore } from '../../store/cartStore';
import { getPendingOrders } from '../../db/queries/queue';
import { reconcileDraftSession } from '../../services/syncService';
import { clearSessionCache, savePendingClose } from '../../db/queries/sessionCache';
import { useNetwork } from '../../context/NetworkContext';
import { logError } from '../../utils/logger';
import { CheckoutPayload, CashSession } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing,
} from '../../constants/theme';

type Props = NativeStackScreenProps<CashierStackParamList, 'CloseSession'>;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    month:  'short', day: 'numeric', year: 'numeric',
    hour:   'numeric', minute: '2-digit', hour12: true,
  });
}

function offlineOrderTotal(payload: CheckoutPayload): number {
  const subtotal = payload.cart_snapshot.reduce(
    (s, i) => s + i.unit_price * i.quantity, 0,
  );
  return Math.max(0, subtotal - (payload.discount_amount ?? 0));
}

export default function CloseSessionScreen({ route, navigation }: Props) {
  const { session: initialSession } = route.params;
  const clearCart = useCartStore((s) => s.clearCart);
  const user      = useAuthStore((s) => s.user)!;

  const { isOnline } = useNetwork();

  const [session,           setSession]           = useState<CashSession>(initialSession);
  const [fetching,          setFetching]          = useState(true);
  const [reconciling,       setReconciling]       = useState(false);
  const [mustReconnect,     setMustReconnect]     = useState(false);
  const [actualCash,        setActualCash]        = useState('');
  const [closing,           setClosing]           = useState(false);
  const [closed,            setClosed]            = useState(false);
  const [closedOffline,     setClosedOffline]     = useState(false);
  const [loggingOut,        setLoggingOut]        = useState(false);
  const [error,             setError]             = useState('');
  const [offlineCashCount,  setOfflineCashCount]  = useState(0);
  const [offlineCashAmount, setOfflineCashAmount] = useState(0);
  const [forceClose,        setForceClose]        = useState(false);

  useEffect(() => {
    async function init() {
      // Draft sessions use UUID format (contains hyphens); real Firestore IDs do not.
      const isDraft = initialSession.id.includes('-');
      let resolvedSession = initialSession;

      if (isDraft) {
        if (isOnline) {
          setReconciling(true);
          try {
            resolvedSession = await reconcileDraftSession(initialSession, user);
            setSession(resolvedSession);
          } catch (err) {
            logError('CloseSessionScreen:reconcile', err, 'Draft session reconciliation failed');
            setMustReconnect(true);
          } finally {
            setReconciling(false);
          }
        } else {
          setMustReconnect(true);
        }
      } else {
        // Fetch latest cash_collected in the background — never block the close UI.
        // initialSession already has the correct ID and enough data to close with.
        getSession(initialSession.id)
          .then((live) => { if (live) setSession(live); })
          .catch(() => {});
      }

      // Pending orders live in SQLite — always fast, no network needed
      const pending = await getPendingOrders();
      const cashOrders = pending.filter(
        (o) => o.payload.session_id === resolvedSession.id
          && o.payload.payment_method === 'cash',
      );
      setOfflineCashCount(cashOrders.length);
      setOfflineCashAmount(cashOrders.reduce((s, o) => s + offlineOrderTotal(o.payload), 0));
      setFetching(false);
    }
    init();
  }, []);

  // Firestore-only expected cash (safe to persist without double-counting)
  const firestoreExpected = session.starting_cash + (session.cash_collected ?? 0);
  // Full expected including unsynced cash (for display reference only)
  const fullExpected      = firestoreExpected + offlineCashAmount;

  const actualNum  = parseFloat(actualCash) || 0;
  const hasActual  = actualCash.trim().length > 0 && !isNaN(parseFloat(actualCash));

  // Always reconcile against fullExpected (offline cash is physically in the drawer)
  const expectedCash = fullExpected;
  const difference   = actualNum - expectedCash;

  const durationStr = (() => {
    const ms = Date.now() - new Date(session.start_time).getTime();
    const h  = Math.floor(ms / 3_600_000);
    const m  = Math.floor((ms % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  })();

  const hasPendingCash  = offlineCashCount > 0;
  const canClose        = forceClose || !hasPendingCash;

  async function handleClose() {
    if (!hasActual) { setError('Enter the actual cash in drawer.'); return; }
    setClosing(true);
    setError('');
    try {
      if (!isOnline) {
        await savePendingClose({
          sessionId:    session.id,
          actualCash:   actualNum,
          expectedCash: fullExpected,
          userId:       user.uid,
          closedAt:     new Date().toISOString(),
        });
        clearSessionCache(user.uid).catch(() => {});
        setClosedOffline(true);
        setClosed(true);
        return;
      }
      // Clock out all still-active roster entries before closing (non-fatal)
      clockOutAllActiveCashiers(session.id, session.roster ?? []).catch((err) =>
        logError('CloseSessionScreen:clockOutAll', err, `session=${session.id}`),
      );
      // Pass fullExpected so the recorded difference reflects all cash including offline.
      // When offline orders eventually sync, they increment expected_cash further —
      // acceptable trade-off vs. showing a wrong variance at close time.
      await closeSession(session.id, actualNum, fullExpected, user.uid, { uid: user.uid, name: user.full_name });
      setClosed(true);
    } catch (err) {
      logError('CloseSessionScreen:handleClose', err, `Failed to close session ${session.id}`);
      setError('Failed to close session. Check your connection.');
      setClosing(false);
    }
  }

  async function handleDone() {
    setLoggingOut(true);
    setError('');
    try {
      clearCart();
      await logout();
    } catch {
      setError('Failed to log out. Try again.');
      setLoggingOut(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'android' ? 'height' : 'padding'}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {fetching || reconciling ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={Colors.green600} />
            {reconciling && (
              <Text style={s.reconcilingText}>Syncing session…</Text>
            )}
          </View>
        ) : mustReconnect ? (
          <View style={s.center}>
            <Text style={s.mustReconnectTitle}>Reconnect Required</Text>
            <Text style={s.mustReconnectBody}>
              This session was started offline and hasn't synced yet.
              Connect to the internet and return to the POS — the session
              will sync automatically, then you can close it.
            </Text>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => navigation.goBack()}
              activeOpacity={0.7}
            >
              <Text style={s.cancelBtnText}>← Go Back</Text>
            </TouchableOpacity>
          </View>
        ) : !closed ? (
          <>
            <View style={s.header}>
              <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
                <Text style={s.backText}>← Back</Text>
              </TouchableOpacity>
              <Text style={s.headerTitle}>🔒 Close Shift</Text>
            </View>

            <View style={s.card}>
              <View style={s.infoGrid}>
                <InfoRow label="Opened by"   value={session.opened_by_name ?? session.cashier_name} />
                {user.uid !== (session.opened_by_uid ?? session.user_id) && (
                  <InfoRow label="Closing as"  value={user.full_name} />
                )}
                <InfoRow label="Shift Start" value={formatDateTime(session.start_time)} />
                <InfoRow label="Duration"    value={durationStr} />
              </View>

              {/* Unsynced cash orders warning */}
              {hasPendingCash && !forceClose && (
                <View style={s.offlineWarn}>
                  <Text style={s.offlineWarnTitle}>
                    ⚠ {offlineCashCount} unsynced cash order{offlineCashCount !== 1 ? 's' : ''} (₱{offlineCashAmount.toFixed(2)})
                  </Text>
                  <Text style={s.offlineWarnBody}>
                    These orders are saved offline and haven't reached the server yet.
                    For accurate reconciliation, go back, reconnect, and let them sync before closing.
                  </Text>
                  <View style={s.offlineWarnActions}>
                    <TouchableOpacity
                      style={s.syncFirstBtn}
                      onPress={() => navigation.goBack()}
                      activeOpacity={0.8}
                    >
                      <Text style={s.syncFirstBtnText}>Go Back & Sync</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.forceCloseLink}
                      onPress={() => setForceClose(true)}
                      activeOpacity={0.7}
                    >
                      <Text style={s.forceCloseLinkText}>Close anyway</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {canClose && (
                <>
                  <View style={s.divider} />

                  {/* Expected cash breakdown */}
                  <Text style={s.sectionLabel}>Expected Cash</Text>
                  <View style={s.infoGrid}>
                    <InfoRow label="Starting Cash" value={`₱${session.starting_cash.toFixed(2)}`} />
                    <InfoRow label="Synced Orders" value={`+₱${(session.cash_collected ?? 0).toFixed(2)}`} />
                    {offlineCashAmount > 0 && (
                      <InfoRow
                        label={`Offline Orders (${offlineCashCount})`}
                        value={`+₱${offlineCashAmount.toFixed(2)}`}
                        note
                      />
                    )}
                    <InfoRow label="Expected Total" value={`₱${expectedCash.toFixed(2)}`} highlight />
                  </View>

                  {offlineCashAmount > 0 && (
                    <View style={s.offlineNote}>
                      <Text style={s.offlineNoteText}>
                        ℹ Offline orders are included above. They will sync automatically when connected.
                      </Text>
                    </View>
                  )}

                  <View style={s.divider} />
                  <Text style={s.sectionLabel}>Count Your Drawer</Text>
                  <Text style={s.inputHint}>
                    Count your cash physically, then enter the total below.
                  </Text>
                  <Text style={s.inputLabel}>Cash in Drawer (₱)</Text>
                  <TextInput
                    style={s.input}
                    placeholder="0.00"
                    placeholderTextColor={Colors.gray400}
                    keyboardType="numeric"
                    value={actualCash}
                    onChangeText={(t) => { setActualCash(t); setError(''); }}
                    returnKeyType="done"
                    onSubmitEditing={handleClose}
                  />

                  {!!error && (
                    <View style={s.errorContainer}>
                      <Text style={s.error}>{error}</Text>
                    </View>
                  )}
                </>
              )}
            </View>

            {canClose && (
              <TouchableOpacity
                style={[s.closeBtn, (!hasActual || closing) && s.closeBtnOff]}
                onPress={handleClose}
                disabled={!hasActual || closing}
                activeOpacity={0.8}
              >
                {closing
                  ? <ActivityIndicator color={Colors.white} />
                  : <Text style={s.closeBtnText}>Close Session</Text>
                }
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => navigation.goBack()}
              disabled={closing}
              activeOpacity={0.7}
            >
              <Text style={s.cancelBtnText}>Cancel — Keep Session Open</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={s.header}>
              <Text style={s.headerTitle}>Shift Closed</Text>
              {closedOffline && (
                <Text style={s.offlineSyncNote}>
                  Saved offline — will sync when reconnected.
                </Text>
              )}
            </View>

            <View style={s.card}>
              {/* Shift handover summary */}
              <Text style={s.sectionLabel}>Shift Summary</Text>
              <View style={s.infoGrid}>
                <InfoRow
                  label="Opened by"
                  value={session.opened_by_name ?? session.cashier_name}
                />
                <InfoRow
                  label="Closed by"
                  value={user.full_name}
                />
                {(session.roster?.length ?? 0) > 0 && (
                  <InfoRow
                    label="Cashiers this shift"
                    value={`${session.roster!.length} — ${session.roster!.map((e) => e.full_name.split(' ')[0]).join(', ')}`}
                  />
                )}
              </View>

              <View style={s.divider} />

              <Text style={s.sectionLabel}>Cash Reconciliation</Text>
              <View style={s.infoGrid}>
                <InfoRow label="Your Count" value={`₱${actualNum.toFixed(2)}`} />
                <InfoRow label="Expected"   value={`₱${expectedCash.toFixed(2)}`} highlight />
                <InfoRow label="Variance"
                  value={difference === 0
                    ? '₱0.00'
                    : `${difference > 0 ? '+' : ''}₱${difference.toFixed(2)}`}
                />
              </View>

              {offlineCashAmount > 0 && (
                <View style={s.offlineNote}>
                  <Text style={s.offlineNoteText}>
                    ℹ ₱{offlineCashAmount.toFixed(2)} from {offlineCashCount} offline order{offlineCashCount !== 1 ? 's' : ''} included. These will sync automatically when connected.
                  </Text>
                </View>
              )}

              <View style={[
                s.diffBox,
                difference > 0  && s.diffOver,
                difference < 0  && s.diffShort,
                difference === 0 && s.diffExact,
              ]}>
                <Text style={s.diffLabel}>
                  {difference > 0 ? 'ℹ️ Overage' : difference < 0 ? '⚠️ Shortage' : '✅ Balanced'}
                </Text>
                <Text style={s.diffAmount}>
                  {difference === 0
                    ? '₱0.00'
                    : `${difference > 0 ? '+' : ''}₱${difference.toFixed(2)}`}
                </Text>
              </View>
            </View>

            {!!error && (
              <View style={s.errorContainer}>
                <Text style={s.error}>{error}</Text>
              </View>
            )}
            <TouchableOpacity
              style={[s.closeBtn, loggingOut && s.closeBtnOff]}
              onPress={handleDone}
              disabled={loggingOut}
              activeOpacity={0.8}
            >
              {loggingOut
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={s.closeBtnText}>Done — Go to Login</Text>
              }
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function InfoRow({
  label, value, highlight, note,
}: { label: string; value: string; highlight?: boolean; note?: boolean }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[
        s.infoValue,
        highlight && s.infoValueHighlight,
        note && s.infoValueNote,
      ]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: Colors.background },
  scroll: {
    padding: Spacing.xl, paddingBottom: Spacing.xxxl,
    maxWidth: 520, alignSelf: 'center', width: '100%', gap: Spacing.lg,
  },

  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  backText:    { fontSize: FontSize.base, color: Colors.green700, fontWeight: FontWeight.medium },
  headerTitle: { fontSize: FontSize.display, fontWeight: FontWeight.bold, color: Colors.gray900 },

  center: { paddingTop: Spacing.xxxl, alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xl },
  reconcilingText:     { fontSize: FontSize.base, color: Colors.gray500, marginTop: Spacing.sm },
  mustReconnectTitle:  { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.gray900, textAlign: 'center' },
  mustReconnectBody:   { fontSize: FontSize.base, color: Colors.gray600, textAlign: 'center', lineHeight: 22 },

  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.xl, gap: Spacing.md, ...Shadow.md,
  },
  sectionLabel: {
    fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.gray500,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  infoGrid: { gap: Spacing.xs },
  infoRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.xs },
  infoLabel: { fontSize: FontSize.base, color: Colors.gray600 },
  infoValue: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray800 },
  infoValueHighlight: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.green700 },
  infoValueNote:      { color: Colors.warning, fontWeight: FontWeight.semibold },
  divider: { height: 1, backgroundColor: Colors.border },

  offlineWarn: {
    backgroundColor: Colors.warningBg, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.warning + '55',
    padding: Spacing.md, gap: Spacing.sm,
  },
  offlineWarnTitle: { fontSize: FontSize.base, fontWeight: FontWeight.bold, color: Colors.warning },
  offlineWarnBody:  { fontSize: FontSize.sm, color: Colors.gray600, lineHeight: 18 },
  offlineWarnActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xs },
  syncFirstBtn: {
    backgroundColor: Colors.green600, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  syncFirstBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.white },
  forceCloseLink:    { paddingVertical: Spacing.sm },
  forceCloseLinkText:{ fontSize: FontSize.sm, color: Colors.danger, fontWeight: FontWeight.medium },

  offlineSyncNote: {
    fontSize: FontSize.sm, color: Colors.warning,
    marginTop: Spacing.xs, textAlign: 'center',
  },
  offlineNote: {
    backgroundColor: Colors.infoBg ?? Colors.gray50,
    borderRadius: Radius.sm, padding: Spacing.sm,
    borderWidth: 1, borderColor: Colors.info + '33',
  },
  offlineNoteText: { fontSize: FontSize.xs, color: Colors.info },

  inputHint:  { fontSize: FontSize.sm, color: Colors.gray500, marginBottom: Spacing.xs },
  inputLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700, marginBottom: Spacing.xs },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    fontSize: FontSize.xxxl, fontWeight: FontWeight.bold,
    color: Colors.gray900, backgroundColor: Colors.gray50,
  },

  diffBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderRadius: Radius.md, padding: Spacing.lg, borderWidth: 1,
  },
  diffOver:  { backgroundColor: Colors.infoBg,   borderColor: '#93c5fd' },
  diffShort: { backgroundColor: Colors.dangerBg,  borderColor: '#fca5a5' },
  diffExact: { backgroundColor: Colors.green50,   borderColor: Colors.green200 },
  diffLabel:  { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray700 },
  diffAmount: { fontSize: FontSize.xxl,  fontWeight: FontWeight.extrabold, color: Colors.gray900 },

  errorContainer: {
    backgroundColor: Colors.dangerBg, borderWidth: 1,
    borderColor: Colors.danger + '44', borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  error: { fontSize: FontSize.sm, color: Colors.danger, fontWeight: FontWeight.medium },

  closeBtn: {
    backgroundColor: Colors.danger, borderRadius: Radius.md,
    paddingVertical: Spacing.lg, alignItems: 'center', ...Shadow.md,
  },
  closeBtnOff:  { backgroundColor: Colors.gray300, ...Shadow.sm },
  closeBtnText: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.white },
  cancelBtn:    { borderRadius: Radius.md, paddingVertical: Spacing.md, alignItems: 'center' },
  cancelBtnText:{ fontSize: FontSize.base, color: Colors.gray500, fontWeight: FontWeight.medium },
});
