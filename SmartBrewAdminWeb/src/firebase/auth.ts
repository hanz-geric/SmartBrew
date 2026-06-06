import {
  signInWithEmailAndPassword, signOut as firebaseSignOut,
  createUserWithEmailAndPassword, getAuth,
} from 'firebase/auth'
import { getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { initializeApp, deleteApp } from 'firebase/app'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { auth, app, firebaseConfig } from './config'
import { userDoc } from './collections'
import type { AuthUser, UserRole } from '@/types'

const DOMAIN = '@smartbrew.app'

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}${DOMAIN}`
}

function mapFirebaseError(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect username or PIN.'
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Try again later.'
    case 'auth/user-disabled':
      return 'This account has been disabled.'
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.'
    default:
      return `Login failed (${code}). Please try again.`
  }
}

export async function loginWithUsername(username: string, pin: string): Promise<AuthUser> {
  const email = usernameToEmail(username)
  try {
    const credential = await signInWithEmailAndPassword(auth, email, pin)
    return await buildAuthUser(credential.user.uid)
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? ''
    throw new Error(mapFirebaseError(code))
  }
}

export async function buildAuthUser(uid: string): Promise<AuthUser> {
  const snap = await getDoc(userDoc(uid))
  if (!snap.exists()) throw new Error('User profile not found.')

  const data = snap.data()
  if (!data.is_active) throw new Error('This account has been disabled.')

  return {
    uid,
    role:      data.role,
    full_name: data.full_name ?? '',
    username:  data.username ?? '',
  }
}

export function logout(): Promise<void> {
  return firebaseSignOut(auth)
}

// Creates a new Firebase Auth + Firestore user without signing out the current admin.
// Uses a secondary app instance so the main auth session is unaffected.
export async function createUserAccount(
  username:  string,
  password:  string,
  full_name: string,
  role:      UserRole,
): Promise<void> {
  const email     = usernameToEmail(username)
  const secondary = initializeApp(firebaseConfig, `secondary_${Date.now()}`)
  const secAuth   = getAuth(secondary)
  try {
    const credential = await createUserWithEmailAndPassword(secAuth, email, password)
    await setDoc(userDoc(credential.user.uid), { username, full_name, role, is_active: true })
  } finally {
    await deleteApp(secondary)
  }
}

export async function resetUserPassword(uid: string, newPassword: string): Promise<void> {
  const functions = getFunctions(app)
  const fn = httpsCallable<{ uid: string; newPassword: string }, { success: boolean }>(
    functions,
    'resetUserPassword',
  )
  await fn({ uid, newPassword })
}

export async function updateUserProfile(
  uid:  string,
  data: { full_name?: string; role?: UserRole; is_active?: boolean },
): Promise<void> {
  await updateDoc(userDoc(uid), data)
}
