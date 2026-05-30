import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CashSession } from '../../types';

interface SessionCacheEntry {
  session:  CashSession;
  isDraft:  boolean;
}

function key(userId: string) {
  return `@smartbrew:session_cache:${userId}`;
}

export async function saveSessionCache(
  session:  CashSession,
  userId:   string,
  isDraft = false,
): Promise<void> {
  const entry: SessionCacheEntry = { session, isDraft };
  await AsyncStorage.setItem(key(userId), JSON.stringify(entry));
}

export async function loadSessionCache(
  userId: string,
): Promise<{ session: CashSession; isDraft: boolean } | null> {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Backwards-compat: old entries were stored as CashSession directly (no isDraft field)
    if ('id' in parsed && 'status' in parsed) {
      return { session: parsed as CashSession, isDraft: false };
    }
    return parsed as SessionCacheEntry;
  } catch {
    return null;
  }
}

export async function clearSessionCache(userId: string): Promise<void> {
  await AsyncStorage.removeItem(key(userId));
}

// Creates a local draft session (never written to Firestore until reconciled)
export async function openSessionOffline(
  userId:       string,
  cashierName:  string,
  startingCash: number,
): Promise<CashSession> {
  const session: CashSession = {
    id:             uuid(),
    user_id:        userId,
    cashier_name:   cashierName,
    start_time:     new Date().toISOString(),
    end_time:       null,
    starting_cash:  startingCash,
    expected_cash:  null,
    actual_cash:    null,
    difference:     null,
    status:         'open',
    cash_collected: 0,
  };
  await saveSessionCache(session, userId, true);
  return session;
}
