import { signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth'
import { getDoc } from 'firebase/firestore'
import { auth } from './config'
import { userDoc } from './collections'
import type { AuthUser } from '@/types'

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
