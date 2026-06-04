import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { AuthUser } from '../../types';

const CACHED_USERS_KEY = 'smartbrew_cached_users_v1';

export interface CachedUserEntry {
  username:  string;
  role:      string;
  full_name: string;
}

export async function listCachedUsers(): Promise<CachedUserEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHED_USERS_KEY);
    return raw ? (JSON.parse(raw) as CachedUserEntry[]) : [];
  } catch {
    return [];
  }
}

async function upsertCachedUser(username: string, user: AuthUser): Promise<void> {
  try {
    const list = await listCachedUsers();
    const next = list.filter(e => e.username !== username);
    next.push({ username, role: user.role, full_name: user.full_name });
    await AsyncStorage.setItem(CACHED_USERS_KEY, JSON.stringify(next));
  } catch {}
}

async function removeCachedUser(username: string): Promise<void> {
  try {
    const list = await listCachedUsers();
    const next = list.filter(e => e.username !== username);
    await AsyncStorage.setItem(CACHED_USERS_KEY, JSON.stringify(next));
  } catch {}
}

// SecureStore keys must be alphanumeric + underscores/hyphens only
function credsKey(username: string): string {
  return `smartbrew_creds_${username.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

interface StoredCredentials {
  password: string;
  user:     AuthUser;
}

export async function saveCredentials(
  username: string,
  password: string,
  user:     AuthUser,
): Promise<void> {
  const entry: StoredCredentials = { password, user };
  await SecureStore.setItemAsync(credsKey(username), JSON.stringify(entry));
  upsertCachedUser(username, user).catch(() => {});
}

// Returns the cached AuthUser if the password matches, null otherwise
export async function verifyOfflineCredentials(
  username: string,
  password: string,
): Promise<AuthUser | null> {
  try {
    const raw = await SecureStore.getItemAsync(credsKey(username));
    if (!raw) return null;
    const entry: StoredCredentials = JSON.parse(raw);
    if (entry.password !== password) return null;
    return entry.user;
  } catch {
    return null;
  }
}

export async function clearCredentials(username: string): Promise<void> {
  await SecureStore.deleteItemAsync(credsKey(username));
  removeCachedUser(username).catch(() => {});
}

// Returns the stored Firebase email + password for a username, used for
// automatic re-authentication when the ID token expires while offline.
export async function getStoredReauthCredentials(
  username: string,
): Promise<{ email: string; password: string } | null> {
  try {
    const raw = await SecureStore.getItemAsync(credsKey(username));
    if (!raw) return null;
    const entry: StoredCredentials = JSON.parse(raw);
    // Mirror the email format used by loginWithUsername in auth.ts
    const email = `${username}@smartbrew.app`;
    return { email, password: entry.password };
  } catch {
    return null;
  }
}
