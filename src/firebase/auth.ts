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
import { auth, firebaseConfig } from './config';
import { userDoc } from './collections';
import { AuthUser, UserRole } from '../types';

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

  return {
    uid:       firebaseUser.uid,
    role:      data.role,
    full_name: data.full_name ?? '',
    username:  data.username ?? '',
  };
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
): Promise<string> {
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
): Promise<AuthUser> {
  const email     = usernameToEmail(username);
  const secondary = initializeApp(firebaseConfig, `switch_${Date.now()}`);
  const secAuth   = getAuth(secondary);
  try {
    const credential = await signInWithEmailAndPassword(secAuth, email, password);
    const snap = await getDoc(userDoc(credential.user.uid));
    if (!snap.exists()) throw new Error('User not found.');
    const data = snap.data();
    if (!data.is_active) throw new Error('This account has been disabled.');
    return {
      uid:       credential.user.uid,
      role:      data.role,
      full_name: data.full_name ?? '',
      username:  data.username ?? '',
    };
  } finally {
    await deleteApp(secondary);
  }
}

export async function logout(): Promise<void> {
  await signOut(auth);
}

export function onAuthChanged(
  callback: (user: AuthUser | null) => void,
): () => void {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      callback(null);
      return;
    }
    try {
      const user = await buildAuthUser(firebaseUser);
      callback(user);
    } catch {
      callback(null);
    }
  });
}
