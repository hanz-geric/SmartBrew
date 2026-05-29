import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CashierStackParamList } from '../../navigation/CashierStack';
import { closeSession, getSession } from '../../firebase/firestoreService';
import { logout } from '../../firebase/auth';
import { useCartStore } from '../../store/cartStore';
import { CashSession } from '../../types';
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

export default function CloseSessionScreen({ route, navigation }: Props) {
  const { session: initialSession } = route.params;
  const clearCart = useCartStore((s) => s.clearCart);

  const [session,    setSession]    = useState<CashSession>(initialSession);
  const [fetching,   setFetching]   = useState(true);
  const [actualCash, setActualCash] = useState('');
  const [closing,    setClosing]    = useState(false);
  const [closed,     setClosed]     = useState(false);
  const [error,      setError]      = useState('');

  // Fetch live session so cash_collected reflects orders placed during the shift
  useEffect(() => {
    getSession(initialSession.id)
      .then((live) => { if (live) setSession(live); })
      .finally(() => setFetching(false));
  }, []);

  const expectedCash = session.starting_cash + (session.cash_collected ?? 0);
  const actualNum    = parseFloat(actualCash) || 0;
  const hasActual    = actualCash.trim().length > 0 && !isNaN(parseFloat(actualCash));
  const difference   = actualNum - expectedCash;

  // Shift duration string (computed once session is loaded)
  const durationStr = (() => {
    const ms = Date.now() - new Date(session.start_time).getTime();
    const h  = Math.floor(ms / 3_600_000);
    const m  = Math.floor((ms % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  })();

  async function handleClose() {
    if (!hasActual) { setError('Enter the actual cash in drawer.'); return; }
    setClosing(true);
    setError('');
    try {
      await closeSession(session.id, actualNum, expectedCash);
      setClosed(true);   // reveal results panel — do NOT logout yet
    } catch {
      setError('Failed to close session. Check your connection.');
      setClosing(false);
    }
  }

  async function handleDone() {
    clearCart();
    await logout();
  }

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {fetching ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={Colors.green600} />
          </View>
        ) : !closed ? (
          /* ── Step 1: Blind count ── */
          <>
            <View style={s.header}>
              <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
                <Text style={s.backText}>← Back</Text>
              </TouchableOpacity>
              <Text style={s.headerTitle}>🔒 Close Shift</Text>
            </View>

            <View style={s.card}>
              <View style={s.infoGrid}>
                <InfoRow label="Cashier"     value={session.cashier_name} />
                <InfoRow label="Shift Start" value={formatDateTime(session.start_time)} />
                <InfoRow label="Duration"    value={durationStr} />
              </View>

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

              {!!error && <Text style={s.error}>{error}</Text>}
            </View>

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

            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => navigation.goBack()}
              disabled={closing}
            >
              <Text style={s.cancelBtnText}>Cancel — Keep Session Open</Text>
            </TouchableOpacity>
          </>
        ) : (
          /* ── Step 2: Results panel (shown only after POST succeeds) ── */
          <>
            <View style={s.header}>
              <Text style={s.headerTitle}>Shift Closed</Text>
            </View>

            <View style={s.card}>
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

              <View style={[
                s.diffBox,
                difference > 0  && s.diffOver,
                difference < 0  && s.diffShort,
                difference === 0 && s.diffExact,
              ]}>
                <Text style={s.diffLabel}>
                  {difference > 0
                    ? 'ℹ️ Overage'
                    : difference < 0
                    ? '⚠️ Shortage'
                    : '✅ Balanced'}
                </Text>
                <Text style={s.diffAmount}>
                  {difference === 0
                    ? '₱0.00'
                    : `${difference > 0 ? '+' : ''}₱${difference.toFixed(2)}`}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={s.closeBtn}
              onPress={handleDone}
              activeOpacity={0.8}
            >
              <Text style={s.closeBtnText}>Done — Go to Login</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function InfoRow({
  label, value, highlight,
}: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, highlight && s.infoValueHighlight]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    padding: Spacing.xl,
    paddingBottom: Spacing.xxxl,
    maxWidth: 520,
    alignSelf: 'center',
    width: '100%',
    gap: Spacing.lg,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  backBtn: {},
  backText: {
    fontSize: FontSize.base,
    color: Colors.green700,
    fontWeight: FontWeight.medium,
  },
  headerTitle: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.gray900,
  },

  center: {
    paddingTop: Spacing.xxxl,
    alignItems: 'center',
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
    ...Shadow.md,
  },
  sectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.gray500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoGrid: { gap: Spacing.xs },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  infoLabel: {
    fontSize: FontSize.base,
    color: Colors.gray600,
  },
  infoValue: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray800,
  },
  infoValueHighlight: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.green700,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
  },

  inputHint: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
    marginBottom: Spacing.xs,
  },
  inputLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.gray700,
    marginBottom: Spacing.xs,
  },
  input: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: FontSize.xxxl,
    fontWeight: FontWeight.bold,
    color: Colors.gray900,
    backgroundColor: Colors.gray50,
  },

  diffBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: Radius.md,
    padding: Spacing.lg,
    borderWidth: 1,
  },
  diffOver: {
    backgroundColor: Colors.infoBg,
    borderColor: '#93c5fd',
  },
  diffShort: {
    backgroundColor: Colors.dangerBg,
    borderColor: '#fca5a5',
  },
  diffExact: {
    backgroundColor: Colors.green50,
    borderColor: Colors.green200,
  },
  diffLabel: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray700,
  },
  diffAmount: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.extrabold,
    color: Colors.gray900,
  },

  error: {
    fontSize: FontSize.sm,
    color: Colors.danger,
  },

  closeBtn: {
    backgroundColor: Colors.danger,
    borderRadius: Radius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    ...Shadow.md,
  },
  closeBtnOff: {
    backgroundColor: Colors.gray300,
    ...Shadow.sm,
  },
  closeBtnText: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
  cancelBtn: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: FontSize.base,
    color: Colors.gray500,
    fontWeight: FontWeight.medium,
  },
});
