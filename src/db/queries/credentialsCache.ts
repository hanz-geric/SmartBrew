import * as SecureStore from 'expo-secure-store';
import { AuthUser } from '../../types';

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
}
