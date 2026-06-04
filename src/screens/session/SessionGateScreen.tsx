import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, KeyboardAvoidingView, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CashierStackParamList } from '../../navigation/CashierStack';
import { useAuthStore } from '../../store/authStore';
import { getAnyOpenSession, getSession, openSession, addCashierToRoster } from '../../firebase/firestoreService';
import { saveSessionCache, loadSessionCache, clearSessionCache, openSessionOffline } from '../../db/queries/sessionCache';
import { syncPendingClose } from '../../services/syncService';
import { logError } from '../../utils/logger';
import { useNetwork } from '../../context/NetworkContext';
import { AuthUser, CashSession } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing, isTablet,
} from '../../constants/theme';

type Props = NativeStackScreenProps<CashierStackParamList, 'SessionGate'>;
type GateState = 'checking' | 'resume' | 'open';

export default function SessionGateScreen({ navigation }: Props) {
  const user       = useAuthStore((s) => s.user)!;
  const { isOnline } = useNetwork();

  const [gateState,    setGateState]    = useState<GateState>('checking');
  const [openSess,     setOpenSess]     = useState<CashSession | null>(null);
  const [startingCash, setStartingCash] = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState('');
  const [fromCache,    setFromCache]    = useState(false);
  const [resumeIsDraft, setResumeIsDraft] = useState(false);

  useEffect(() => { checkSession(); }, []);

  // When we showed a cache-loaded session and network becomes available,
  // verify the session is still open in Firestore. If it was closed elsewhere
  // (or the cache was stale from a previous logout), clear it and let the
  // user open a fresh session instead of resuming a ghost one.
  useEffect(() => {
    if (!isOnline) return;
    syncPendingClose().catch(() => {});
    if (!fromCache || !openSess) return;
    getSession(openSess.id)
      .then((live) => {
        if (!live || live.status !== 'open') {
          // Session no longer open in Firestore — clear stale cache (both keys)
          clearSessionCache(user.uid).catch((err) =>
            logError('SessionGate:verifyCache', err, `Stale session cache for uid=${user.uid}`),
          );
          setOpenSess(null);
          setFromCache(false);
          setGateState('open');
        } else {
          // Session is genuinely open — update cache with live data and clear offline flag
          setOpenSess(live);
          setFromCache(false);
          saveSessionCache(live, user.uid, resumeIsDraft).catch(() => {});
        }
      })
      .catch(() => {
        // Firestore unreachable — keep showing cache, user can retry
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  async function checkSession() {
    // Drain any offline-closed session before querying Firestore, so a pending
    // close isn't mistaken for an active open session.
    if (isOnline) await syncPendingClose().catch(() => {});
    try {
      // Query for ANY open session on this register (not just opened by this user).
      // This is the core of the register-owned model: A opens, B can resume/close.
      let session = await getAnyOpenSession();

      if (session) {
        // If the logged-in user is not on the roster, auto-add them (they're
        // taking over the register from whoever was last on it).
        const roster = session.roster ?? [];
        const inRoster = roster.some((e) => e.uid === user.uid);
        if (!inRoster) {
          const prevEntry = roster.find((e) => e.uid === (session!.active_cashier_uid ?? session!.user_id));
          const prevUser: AuthUser = prevEntry
            ? { uid: prevEntry.uid, username: prevEntry.username, full_name: prevEntry.full_name, role: prevEntry.role }
            : { uid: session.user_id, username: '', full_name: session.cashier_name, role: 'cashier' };
          try {
            const { roster: updatedRoster } = await addCashierToRoster(
              session.id, user, prevUser, roster,
            );
            session = { ...session, roster: updatedRoster, active_cashier_uid: user.uid, active_cashier_name: user.full_name };
          } catch (err) {
            logError('SessionGate:autoAddCashier', err, `uid=${user.uid}`);
          }
        }
        setOpenSess(session);
        setGateState('resume');
        saveSessionCache(session, user.uid, false).catch(() => {});
      } else {
        setGateState('open');
      }
    } catch {
      // Network unavailable — try local cache (falls back to device-level key
      // so a different user can resume a drawer opened by someone else offline).
      const cached = await loadSessionCache(user.uid);
      if (cached && cached.session.status === 'open') {
        setOpenSess(cached.session);
        setResumeIsDraft(cached.isDraft);
        setFromCache(true);
        setGateState('resume');
      } else {
        setGateState('open');
      }
    }
  }

  async function handleOpenSession() {
    const amount = parseFloat(startingCash);
    if (isNaN(amount) || amount < 0) { setError('Enter a valid starting cash amount.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const session = await openSession(user.uid, user.full_name, amount, undefined, { username: user.username, role: user.role });
      navigation.replace('POS', { session, isDraft: false });
    } catch {
      setError('Failed to open session. Try again.');
      setSubmitting(false);
    }
  }

  async function handleOpenSessionOffline() {
    const amount = parseFloat(startingCash);
    if (isNaN(amount) || amount < 0) { setError('Enter a valid starting cash amount.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const session = await openSessionOffline(user.uid, user.full_name, amount, { username: user.username, role: user.role });
      navigation.replace('POS', { session, isDraft: true });
    } catch {
      setError('Failed to create offline session. Try again.');
      setSubmitting(false);
    }
  }

  // ── Checking ─────────────────────────────────────────────────────────────────

  if (gateState === 'checking') {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={Colors.green600} />
        <Text style={s.checkingText}>Checking session…</Text>
      </View>
    );
  }

  // ── Resume existing session ───────────────────────────────────────────────────

  if (gateState === 'resume' && openSess) {
    const started = new Date(openSess.start_time).toLocaleString('en-PH', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
    return (
      <View style={s.center}>
        <View style={s.card}>
          <Image
            source={require('../../../assets/images/SmartBrew_logo.jpg')}
            style={s.logo}
            resizeMode="contain"
          />
          <Text style={s.title}>Shift In Progress</Text>
          <Text style={s.subtitle}>{openSess.cashier_name}</Text>
          <Text style={s.sessionInfo}>Started {started}</Text>

          {fromCache && (
            <View style={s.offlineBanner}>
              <Text style={s.offlineBannerText}>
                {resumeIsDraft
                  ? '⚠  Offline - draft session. Orders will sync when connected.'
                  : '⚠  Offline - resuming from cached session. Orders will sync when connected.'}
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={s.btn}
            onPress={() => navigation.replace('POS', { session: openSess, isDraft: resumeIsDraft })}
            activeOpacity={0.8}
          >
            <Text style={s.btnText}>Continue Shift</Text>
          </TouchableOpacity>

          {/* Only show End Shift if the session is real (not a draft) and we're online */}
          {!fromCache && !resumeIsDraft && (
            <TouchableOpacity
              style={s.btnSecondary}
              onPress={() => navigation.navigate('CloseSession', { session: openSess })}
              activeOpacity={0.8}
            >
              <Text style={s.btnSecondaryText}>End Shift</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  // ── Open new session ──────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={s.center}
      behavior={Platform.OS === 'android' ? 'height' : 'padding'}
    >
      <View style={s.card}>
        <Image
          source={require('../../../assets/images/SmartBrew_logo.jpg')}
          style={s.logo}
          resizeMode="contain"
        />
        <Text style={s.title}>Open Cash Session</Text>
        <Text style={s.subtitle}>{user.full_name}</Text>

        <Text style={s.label}>Starting Cash (₱)</Text>
        <TextInput
          style={s.input}
          placeholder="0.00"
          placeholderTextColor={Colors.gray400}
          keyboardType="numeric"
          value={startingCash}
          onChangeText={(t) => { setStartingCash(t); setError(''); }}
          returnKeyType="done"
          onSubmitEditing={isOnline ? handleOpenSession : handleOpenSessionOffline}
        />

        <View style={s.quickRow}>
          {[500, 1000, 2000, 5000].map((amt) => (
            <TouchableOpacity
              key={amt}
              style={s.quickBtn}
              onPress={() => { setStartingCash(String(amt)); setError(''); }}
              activeOpacity={0.7}
            >
              <Text style={s.quickBtnText}>₱{amt.toLocaleString()}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {!!error && (
          <View style={s.errorContainer}>
            <Text style={s.error}>{error}</Text>
          </View>
        )}

        {isOnline ? (
          <TouchableOpacity
            style={[s.btn, submitting && s.btnDisabled]}
            onPress={handleOpenSession}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting
              ? <ActivityIndicator color={Colors.white} />
              : <Text style={s.btnText}>Open Session</Text>
            }
          </TouchableOpacity>
        ) : (
          <>
            <View style={s.offlineBanner}>
              <Text style={s.offlineBannerText}>
                ⚠ No connection — you can start a draft session. It will sync to the server when you reconnect.
              </Text>
            </View>
            <TouchableOpacity
              style={[s.btn, submitting && s.btnDisabled]}
              onPress={handleOpenSessionOffline}
              disabled={submitting}
              activeOpacity={0.8}
            >
              {submitting
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={s.btnText}>Start Offline Session</Text>
              }
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  center: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: Colors.background, padding: Spacing.xl,
  },
  card: {
    width: '100%', maxWidth: isTablet ? 480 : 400,
    backgroundColor: Colors.surface, borderRadius: Radius.xl,
    padding: Spacing.xxl, gap: Spacing.md, ...Shadow.lg,
  },
  logo:        { width: 180, height: 72, alignSelf: 'center', marginBottom: Spacing.xs },
  title:       { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.gray800, textAlign: 'center' },
  subtitle:    { fontSize: FontSize.base, color: Colors.gray500, textAlign: 'center' },
  sessionInfo: { fontSize: FontSize.sm, color: Colors.green700, textAlign: 'center', fontWeight: FontWeight.medium },

  quickRow: { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap' },
  quickBtn: {
    flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md,
    backgroundColor: Colors.gray100, borderWidth: 1, borderColor: Colors.border, alignItems: 'center',
  },
  quickBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700 },

  label: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.gray700, marginTop: Spacing.xs },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    fontSize: FontSize.xl, fontWeight: FontWeight.semibold,
    color: Colors.gray900, backgroundColor: Colors.gray50,
  },

  errorContainer: {
    backgroundColor: Colors.dangerBg, borderWidth: 1,
    borderColor: Colors.danger + '44', borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  error: { fontSize: FontSize.sm, color: Colors.danger, fontWeight: FontWeight.medium },

  offlineBanner: {
    backgroundColor: Colors.warningBg, borderWidth: 1,
    borderColor: Colors.warning + '66', borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  offlineBannerText: {
    fontSize: FontSize.sm, color: Colors.warning,
    fontWeight: FontWeight.medium, textAlign: 'center',
  },

  btn: {
    backgroundColor: Colors.green600, borderRadius: Radius.md,
    paddingVertical: Spacing.lg, alignItems: 'center', marginTop: Spacing.xs,
  },
  btnDisabled:      { opacity: 0.6 },
  btnText:          { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.white },
  btnSecondary: {
    borderRadius: Radius.md, paddingVertical: Spacing.md, alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.gray300,
  },
  btnSecondaryText: { fontSize: FontSize.base, fontWeight: FontWeight.semibold, color: Colors.gray600 },
  checkingText:     { marginTop: Spacing.md, fontSize: FontSize.base, color: Colors.gray500 },
});
