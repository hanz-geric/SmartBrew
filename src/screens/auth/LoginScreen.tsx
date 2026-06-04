import { useState } from 'react';
import {
  View, Text,
  StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator, ScrollView, Image,
} from 'react-native';
import { loginWithUsername, saveAuthCache } from '../../firebase/auth';
import { useAuthStore } from '../../store/authStore';
import { useNetwork } from '../../context/NetworkContext';
import { saveCredentials, verifyOfflineCredentials } from '../../db/queries/credentialsCache';
import { getProducts, getCategories } from '../../firebase/firestoreService';
import { PinKeypad, UsernameDropdown } from '../../components/ui';
import { Colors, Spacing, Radius, FontSize, FontWeight, Shadow } from '../../constants/theme';

export default function LoginScreen() {
  const { setUser }             = useAuthStore();
  const { isOnline }            = useNetwork();
  const [username, setUsername] = useState('');
  const [pin,      setPin]      = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // No auto-login from cache here — auth.currentUser would be null without a
  // real Firebase session, causing permission-denied on all Firestore writes.

  async function handleLogin(completedPin?: string) {
    const pwd = completedPin ?? pin;
    if (!username.trim() || pwd.length < 6) {
      setError('Enter your username and 6-digit PIN.');
      setPin('');
      return;
    }

    setLoading(true);
    setError('');

    if (!isOnline) {
      // Offline — verify against locally stored credentials
      try {
        const user = await verifyOfflineCredentials(username.trim().toLowerCase(), pwd);
        if (user) {
          saveAuthCache(user).catch(() => {});
          setUser(user);
        } else {
          setPin('');
          setError('Incorrect credentials, or this account has not been used on this device while online.');
        }
      } catch {
        setPin('');
        setError('Offline sign-in failed. Try again.');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Online — normal Firebase login
    try {
      const user = await loginWithUsername(username.trim(), pwd);
      // Save credentials to device for future offline logins
      saveCredentials(username.trim().toLowerCase(), pwd, user).catch(() => {});
      // Pre-cache the product catalog so the POS works on the next offline launch
      getProducts().catch(() => {});
      getCategories().catch(() => {});
      setUser(user);
    } catch (e: unknown) {
      setPin('');
      setError(e instanceof Error ? e.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'android' ? 'height' : 'padding'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.tagline}>Sign in to continue</Text>
        </View>

        {!isOnline && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>
              ⚠ Offline — you can still sign in if you've logged in on this device before.
            </Text>
          </View>
        )}

        {!!error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Username</Text>
          <UsernameDropdown
            value={username}
            onChange={(u) => { setUsername(u); setPin(''); }}
            disabled={loading}
            placeholder="Select username"
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>PIN</Text>
          <PinKeypad
            pin={pin}
            onChange={setPin}
            onComplete={handleLogin}
            disabled={loading}
          />
        </View>

        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={Colors.green600} />
            <Text style={styles.loadingText}>Signing in…</Text>
          </View>
        )}
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.green700,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.xl,
    padding: Spacing.xxl,
    width: '100%',
    maxWidth: 400,
    ...Shadow.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.xxl,
  },
  tagline: {
    fontSize: FontSize.sm,
    color: Colors.gray400,
  },
  offlineBanner: {
    backgroundColor: Colors.warningBg,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.warning + '55',
  },
  offlineText: {
    color: Colors.warning,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorBanner: {
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.danger + '44',
  },
  errorText: {
    color: Colors.danger,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    textAlign: 'center',
  },
  fieldGroup: {
    marginBottom: Spacing.lg,
  },
  label: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: Colors.gray500,
    marginBottom: Spacing.xs,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  loadingText: {
    fontSize: FontSize.sm,
    color: Colors.gray500,
  },
});
