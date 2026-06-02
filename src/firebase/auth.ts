import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  getAuth,
  User,
} from 'firebase/auth';
import { deleteApp, initializeApp } from 'firebase/app';
import { getDoc, setDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, firebaseConfig } from './config';
import { userDoc } from './collections';
import { clearSessionCache } from '../db/queries/sessionCache';
import { saveCredentials, verifyOfflineCredentials } from '../db/queries/credentialsCache';
import { logError } from '../utils/logger';
import { AuthUser, UserRole } from '../types';
import { useAuthStore } from '../store/authStore';

const AUTH_CACHE_KEY = '@smartbrew:auth_user';

export async function saveAuthCache(user: AuthUser): Promise<void> {
  await AsyncStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(user));
}

export async function loadAuthCache(): Promise<AuthUser | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_CACHE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

async function clearAuthCache(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_CACHE_KEY);
}

const DOMAIN = '@smartbrew.app';

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}${DOMAIN}`;
}

function mapFirebaseError(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect username or password.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Try again later.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not enabled in Firebase Console.';
    default:
      return `Login failed (${code}). Please try again.`;
  }
}

export async function loginWithUsername(
  username: string,
  password: string,
): Promise<AuthUser> {
  const email = usernameToEmail(username.trim().toLowerCase());
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    return await buildAuthUser(credential.user);
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? '';
    console.error('[Firebase Auth] error code:', code, err);
    throw new Error(mapFirebaseError(code));
  }
}

export async function buildAuthUser(firebaseUser: User): Promise<AuthUser> {
  const snap = await getDoc(userDoc(firebaseUser.uid));
  if (!snap.exists()) throw new Error('User profile not found.');

  const data = snap.data();
  if (!data.is_active) throw new Error('This account has been disabled.');

  const user: AuthUser = {
    uid:       firebaseUser.uid,
    role:      data.role,
    full_name: data.full_name ?? '',
    username:  data.username ?? '',
  };
  saveAuthCache(user).catch(() => {});
  return user;
}

// Creates a new Firebase Auth + Firestore user without signing out the current admin.
// Uses a secondary app instance so the main auth session is unaffected.
export async function createUserAccount(
  username:  string,
  password:  string,
  full_name: string,
  role:      UserRole,
): Promise<void> {
  const email      = usernameToEmail(username);
  const secondary  = initializeApp(firebaseConfig, `secondary_${Date.now()}`);
  const secAuth    = getAuth(secondary);
  try {
    const credential = await createUserWithEmailAndPassword(secAuth, email, password);
    await setDoc(userDoc(credential.user.uid), {
      username,
      full_name,
      role,
      is_active: true,
    });
  } finally {
    await deleteApp(secondary);
  }
}

// Verifies that the given credentials belong to an admin or manager.
// Uses a secondary app so the current cashier session is never interrupted.
// Returns a one-time nonce string on success (stored in order for audit trail).
export async function verifyManagerAuth(
  username: string,
  password: string,
  isOnline = true,
): Promise<string> {
  if (!isOnline) {
    const cached = await verifyOfflineCredentials(username, password);
    if (!cached) throw new Error('Incorrect username or password.');
    if (cached.role !== 'admin' && cached.role !== 'manager') {
      throw new Error('Only an admin or manager can authorise discounts.');
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  const email     = usernameToEmail(username);
  const secondary = initializeApp(firebaseConfig, `verify_${Date.now()}`);
  const secAuth   = getAuth(secondary);
  try {
    const credential = await signInWithEmailAndPassword(secAuth, email, password);
    const snap = await getDoc(userDoc(credential.user.uid));
    if (!snap.exists()) throw new Error('User not found.');
    const data = snap.data();
    if (!data.is_active) throw new Error('This account is inactive.');
    if (data.role !== 'admin' && data.role !== 'manager') {
      throw new Error('Only an admin or manager can authorise discounts.');
    }
    const user: AuthUser = {
      uid:       credential.user.uid,
      role:      data.role,
      full_name: data.full_name ?? '',
      username:  data.username ?? username,
    };
    saveCredentials(username, password, user).catch(() => {});
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  } finally {
    await deleteApp(secondary);
  }
}

// Verifies any active user's credentials and returns their profile.
// Uses a secondary app so the current session is never interrupted.
// Used for mid-shift cashier switch.
export async function switchCashierAuth(
  username: string,
  password: string,
  isOnline = true,
): Promise<AuthUser> {
  if (!isOnline) {
    const cached = await verifyOfflineCredentials(username, password);
    if (!cached) throw new Error('Incorrect username or password.');
    return cached;
  }

  const email     = usernameToEmail(username);
  const secondary = initializeApp(firebaseConfig, `switch_${Date.now()}`);
  const secAuth   = getAuth(secondary);
  try {
    const credential = await signInWithEmailAndPassword(secAuth, email, password);
    const snap = await getDoc(userDoc(credential.user.uid));
    if (!snap.exists()) throw new Error('User not found.');
    const data = snap.data();
    if (!data.is_active) throw new Error('This account has been disabled.');
    const user: AuthUser = {
      uid:       credential.user.uid,
      role:      data.role,
      full_name: data.full_name ?? '',
      username:  data.username ?? '',
    };
    saveCredentials(username, password, user).catch(() => {});
    return user;
  } finally {
    await deleteApp(secondary);
  }
}

export async function logout(): Promise<void> {
  const uid = auth.currentUser?.uid;

  // Clear the auth cache FIRST (and await it): the onAuthStateChanged(null)
  // listener in RootNavigator reads this cache, and must find it empty so it
  // doesn't reload the profile and bounce us back to the POS screen.
  // removeItem is fast; guard it so a failure can never block sign-out.
  await clearAuthCache().catch((err) => logError('logout:clearAuthCache', err));

  // Flip the app's auth state IMMEDIATELY. RootNavigator renders AuthStack the
  // moment `user` is null, so navigation to Login no longer depends on signOut()
  // finishing. This is the critical ordering fix: setUser must run BEFORE the
  // awaits below, because a `.catch()` only handles a *rejected* promise — it
  // does nothing for one that hangs or settles slowly. Previously this line sat
  // last, after `await signOut(auth)`; if signOut stalled (Firebase auth /
  // AsyncStorage persistence layer), logout() never reached it and the user was
  // stranded on POS with the Sign Out dialog already dismissed — the exact
  // reported symptom.
  useAuthStore.getState().setUser(null);

  // Best-effort, non-blocking cleanup. Safe to fire-and-forget now that the UI
  // has already signed out — a locked DB or dead network can't strand the user.
  signOut(auth).catch((err) =>
    logError('logout:signOut', err, 'Firebase signOut failed — continuing with local clear'),
  );
  // Clear only the per-user cache, NOT the device-level register cache.
  // The session may still be open for the next cashier to resume on this device.
  if (uid) {
    clearSessionCache(uid, { keepRegister: true }).catch((err) =>
      logError('logout:clearSessionCache', err, `uid=${uid}`),
    );
  }
}

export function onAuthChanged(
  callback: (user: AuthUser | null) => void,
): () => void {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      // Firebase Auth has no valid user. Two distinct cases:
      //
      // 1. Genuine logout — logout() called clearAuthCache() first, so
      //    loadAuthCache() returns null → callback(null) → login screen ✓
      //
      // 2. Offline with expired token — the device lost network before the
      //    token could be refreshed. Firebase fires null here, but the user
      //    IS still "logged in" from the business perspective. The cache
      //    still has their profile (clearAuthCache was NOT called), so we
      //    keep them on the cashier screen. When the network returns, Firebase
      //    Auth silently refreshes the token and auth.currentUser gets set,
      //    unblocking Firestore writes via getFirebaseUser().
      const cached = await loadAuthCache();
      callback(cached);
      return;
    }
    try {
      const user = await buildAuthUser(firebaseUser);
      callback(user);
    } catch {
      // Firebase token exists but Firestore is unreachable (offline).
      const cached = await loadAuthCache();
      callback(cached);
    }
  });
}
