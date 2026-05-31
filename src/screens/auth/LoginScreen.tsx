import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { loginWithUsername, saveAuthCache } from '../../firebase/auth';
import { useAuthStore } from '../../store/authStore';
import { useNetwork } from '../../context/NetworkContext';
import { saveCredentials, verifyOfflineCredentials } from '../../db/queries/credentialsCache';
import { getProducts, getCategories } from '../../firebase/firestoreService';
import { Colors, Spacing, Radius, FontSize, FontWeight, Shadow } from '../../constants/theme';

export default function LoginScreen() {
  const { setUser }             = useAuthStore();
  const { isOnline }            = useNetwork();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // No auto-login from cache here — auth.currentUser would be null without a
  // real Firebase session, causing permission-denied on all Firestore writes.

  async function handleLogin() {
    if (!username.trim() || !password) {
      setError('Enter username and password.');
      return;
    }

    setLoading(true);
    setError('');

    if (!isOnline) {
      // Offline — verify against locally stored credentials
      try {
        const user = await verifyOfflineCredentials(username.trim().toLowerCase(), password);
        if (user) {
          saveAuthCache(user).catch(() => {});
          setUser(user);
        } else {
          setError('Incorrect credentials, or this account has not been used on this device while online.');
        }
      } catch {
        setError('Offline sign-in failed. Try again.');
      } finally {
        setLoading(false);
      }
      return;
    }

    // Online — normal Firebase login
    try {
      const user = await loginWithUsername(username.trim(), password);
      // Save credentials to device for future offline logins
      saveCredentials(username.trim().toLowerCase(), password, user).catch(() => {});
      // Pre-cache the product catalog so the POS works on the next offline launch
      getProducts().catch(() => {});
      getCategories().catch(() => {});
      setUser(user);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoLetter}>S</Text>
          </View>
          <Text style={styles.appName}>SmartBrew POS</Text>
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
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Enter username"
            placeholderTextColor={Colors.gray400}
            returnKeyType="next"
            editable={!loading}
          />
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Enter password"
            placeholderTextColor={Colors.gray400}
            returnKeyType="done"
            onSubmitEditing={handleLogin}
            editable={!loading}
          />
        </View>

        <TouchableOpacity
          style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color={Colors.white} />
            : <Text style={styles.loginBtnText}>Sign In</Text>
          }
        </TouchableOpacity>
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
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.green700,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  logoLetter: {
    fontSize: 36,
    fontWeight: FontWeight.extrabold,
    color: Colors.white,
  },
  appName: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.extrabold,
    color: Colors.gray800,
    marginBottom: Spacing.xs,
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
  input: {
    borderWidth: 1.5,
    borderColor: Colors.gray200,
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.gray800,
    backgroundColor: Colors.gray50,
  },
  loginBtn: {
    backgroundColor: Colors.green600,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  loginBtnDisabled: {
    opacity: 0.6,
  },
  loginBtnText: {
    color: Colors.white,
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
  },
});
