import { signInWithEmailAndPassword, User as FirebaseUser } from 'firebase/auth';
import { auth, getFirebaseUser } from './config';
import { loadAuthCache } from './auth';
import { getStoredReauthCredentials } from '../db/queries/credentialsCache';
import { logError } from '../utils/logger';

// How long to wait for Firebase Auth to restore from persistence before
// falling back to credential-based re-authentication.
const AUTH_RESTORE_WAIT_MS = 5_000;

/**
 * Returns the currently signed-in Firebase user, with automatic re-authentication
 * as a fallback when the ID token expired during an offline period.
 *
 * Flow:
 *  1. Return auth.currentUser immediately if available.
 *  2. Wait up to 5 s for Firebase Auth to restore from AsyncStorage persistence.
 *  3. If still null, check whether we have a cached auth profile (user was
 *     logged in, not signed out) AND stored credentials in expo-secure-store.
 *  4. If both exist, call signInWithEmailAndPassword to get a fresh Firebase
 *     session — this succeeds as long as we now have network.
 *  5. Return the re-authenticated user, or null if everything fails.
 *
 * Deliberately does NOT re-auth if the auth cache is empty (user properly
 * logged out via logout()), preserving intended sign-out behaviour.
 */
export async function ensureAuthenticated(): Promise<FirebaseUser | null> {
  if (auth.currentUser) return auth.currentUser;

  // Give Firebase Auth a chance to restore the session from AsyncStorage
  const restored = await getFirebaseUser(AUTH_RESTORE_WAIT_MS);
  if (restored) return restored;

  // Firebase Auth didn't restore in time. Check if the user should still be
  // signed in (cache exists = was logged in, not explicitly signed out).
  try {
    const cachedUser = await loadAuthCache();
    if (!cachedUser) {
      // Auth cache is empty — user called logout(), so no auto re-auth.
      return null;
    }

    const creds = await getStoredReauthCredentials(cachedUser.username);
    if (!creds) {
      logError(
        'ensureAuthenticated:noCredentials',
        null,
        `No stored credentials for ${cachedUser.username} — device may not have logged in online yet`,
      );
      return null;
    }

    console.log(`[ensureAuthenticated] Re-authenticating ${cachedUser.username} with stored credentials…`);
    const credential = await signInWithEmailAndPassword(auth, creds.email, creds.password);
    console.log(`[ensureAuthenticated] Re-auth OK — uid=${credential.user.uid}`);
    return credential.user;
  } catch (err) {
    logError('ensureAuthenticated:reauth', err, 'Silent re-authentication failed');
    return null;
  }
}
