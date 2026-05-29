import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CashierStackParamList } from '../../navigation/CashierStack';
import { useAuthStore } from '../../store/authStore';
import { getOpenSession, openSession } from '../../firebase/firestoreService';
import { CashSession } from '../../types';
import {
  Colors, FontSize, FontWeight, Radius, Shadow, Spacing, isTablet,
} from '../../constants/theme';

type Props = NativeStackScreenProps<CashierStackParamList, 'SessionGate'>;

type GateState = 'checking' | 'resume' | 'open';

export default function SessionGateScreen({ navigation }: Props) {
  const user = useAuthStore((s) => s.user)!;

  const [gateState,    setGateState]    = useState<GateState>('checking');
  const [openSess,     setOpenSess]     = useState<CashSession | null>(null);
  const [startingCash, setStartingCash] = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState('');

  useEffect(() => { checkSession(); }, []);

  async function checkSession() {
    try {
      const session = await getOpenSession(user.uid);
      if (session) {
        setOpenSess(session);
        setGateState('resume');
      } else {
        setGateState('open');
      }
    } catch {
      setError('Could not check session status. Check your connection.');
      setGateState('open');
    }
  }

  async function handleOpenSession() {
    const amount = parseFloat(startingCash);
    if (isNaN(amount) || amount < 0) {
      setError('Enter a valid starting cash amount.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const session = await openSession(user.uid, user.full_name, amount);
      navigation.replace('POS', { session });
    } catch {
      setError('Failed to open session. Try again.');
      setSubmitting(false);
    }
  }

  // ── Checking ──────────────────────────────────────────────────────────────

  if (gateState === 'checking') {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={Colors.green600} />
        <Text style={s.checkingText}>Checking session…</Text>
      </View>
    );
  }

  // ── Resume or Close existing session ──────────────────────────────────────

  if (gateState === 'resume' && openSess) {
    const started = new Date(openSess.start_time).toLocaleString('en-PH', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
    return (
      <View style={s.center}>
        <View style={s.card}>
          <Text style={s.logo}>☕ SmartBrew POS</Text>
          <Text style={s.title}>Shift In Progress</Text>
          <Text style={s.subtitle}>{openSess.cashier_name}</Text>
          <Text style={s.sessionInfo}>Started {started}</Text>

          <TouchableOpacity
            style={s.btn}
            onPress={() => navigation.replace('POS', { session: openSess })}
            activeOpacity={0.8}
          >
            <Text style={s.btnText}>Continue Shift</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.btnSecondary}
            onPress={() => navigation.navigate('CloseSession', { session: openSess })}
            activeOpacity={0.8}
          >
            <Text style={s.btnSecondaryText}>End Shift</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Open new session ──────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={s.center}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={s.card}>
        <Text style={s.logo}>☕ SmartBrew POS</Text>
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
          onSubmitEditing={handleOpenSession}
        />

        {/* Quick-fill denominations */}
        <View style={s.quickRow}>
          {[500, 1000, 2000, 5000].map((amt) => (
            <TouchableOpacity
              key={amt}
              style={s.quickBtn}
              onPress={() => { setStartingCash(String(amt)); setError(''); }}
              activeOpacity={0.7}
            >
              <Text style={s.quickBtnText}>
                ₱{amt.toLocaleString()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {!!error && <Text style={s.error}>{error}</Text>}

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
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    padding: Spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: isTablet ? 480 : 400,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xxl,
    gap: Spacing.md,
    ...Shadow.lg,
  },
  logo: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.green700,
    textAlign: 'center',
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.gray800,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FontSize.base,
    color: Colors.gray500,
    textAlign: 'center',
  },
  sessionInfo: {
    fontSize: FontSize.sm,
    color: Colors.green700,
    textAlign: 'center',
    fontWeight: FontWeight.medium,
  },
  quickRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    flexWrap: 'wrap',
  },
  quickBtn: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.gray100,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  quickBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.gray700,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.gray700,
    marginTop: Spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: FontSize.xl,
    fontWeight: FontWeight.semibold,
    color: Colors.gray900,
    backgroundColor: Colors.gray50,
  },
  error: {
    fontSize: FontSize.sm,
    color: Colors.danger,
  },
  btn: {
    backgroundColor: Colors.green600,
    borderRadius: Radius.md,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.white,
  },
  btnSecondary: {
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.gray300,
  },
  btnSecondaryText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semibold,
    color: Colors.gray600,
  },
  checkingText: {
    marginTop: Spacing.md,
    fontSize: FontSize.base,
    color: Colors.gray500,
  },
});
