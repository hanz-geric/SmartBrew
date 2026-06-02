import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CashierEvent, CashSession, RosterEntry, UserRole } from '../../types';

interface SessionCacheEntry {
  session:  CashSession;
  isDraft:  boolean;
}

function key(userId: string) {
  return `@smartbrew:session_cache:${userId}`;
}

// Device-level key — stores the register's current open session so any user
// who logs in on the same device can resume it without knowing who opened it.
const REGISTER_CACHE_KEY = '@smartbrew:session_cache:register';

function parseEntry(raw: string): { session: CashSession; isDraft: boolean } | null {
  try {
    const parsed = JSON.parse(raw);
    if ('id' in parsed && 'status' in parsed) {
      return { session: parsed as CashSession, isDraft: false };
    }
    return parsed as SessionCacheEntry;
  } catch {
    return null;
  }
}

export async function saveSessionCache(
  session:  CashSession,
  userId:   string,
  isDraft = false,
): Promise<void> {
  const entry: SessionCacheEntry = { session, isDraft };
  const json = JSON.stringify(entry);
  await Promise.all([
    AsyncStorage.setItem(key(userId), json),
    // Always mirror to device key so a different user logging in can find it
    AsyncStorage.setItem(REGISTER_CACHE_KEY, json),
  ]);
}

export async function loadSessionCache(
  userId: string,
): Promise<{ session: CashSession; isDraft: boolean } | null> {
  try {
    // 1. Try the user-specific key first (fastest path, same user)
    const userRaw = await AsyncStorage.getItem(key(userId));
    if (userRaw) return parseEntry(userRaw);

    // 2. Fall back to device-level key (cross-login: different user, same register)
    const deviceRaw = await AsyncStorage.getItem(REGISTER_CACHE_KEY);
    if (deviceRaw) return parseEntry(deviceRaw);

    return null;
  } catch {
    return null;
  }
}

// opts.keepRegister = true when logging out but the session is still open;
// we want a different user who logs in to still find the drawer via device cache.
export async function clearSessionCache(
  userId: string,
  opts?: { keepRegister?: boolean },
): Promise<void> {
  const ops: Promise<void>[] = [AsyncStorage.removeItem(key(userId))];
  if (!opts?.keepRegister) ops.push(AsyncStorage.removeItem(REGISTER_CACHE_KEY));
  await Promise.all(ops);
}

// ─── Pending close (offline session close queued for sync) ───────────────────

const PENDING_CLOSE_KEY = '@smartbrew:pending_session_close';

export interface PendingClose {
  sessionId:    string;
  actualCash:   number;
  expectedCash: number;
  userId:       string;
  closedAt:     string;
}

export async function savePendingClose(data: PendingClose): Promise<void> {
  await AsyncStorage.setItem(PENDING_CLOSE_KEY, JSON.stringify(data));
}

export async function loadPendingClose(): Promise<PendingClose | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_CLOSE_KEY);
    return raw ? (JSON.parse(raw) as PendingClose) : null;
  } catch {
    return null;
  }
}

export async function clearPendingClose(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_CLOSE_KEY);
}

// Creates a local draft session (never written to Firestore until reconciled)
export async function openSessionOffline(
  userId:       string,
  cashierName:  string,
  startingCash: number,
  userInfo?:    { username: string; role: UserRole },
): Promise<CashSession> {
  const now      = new Date().toISOString();
  const role     = userInfo?.role     ?? 'cashier';
  const username = userInfo?.username ?? '';

  const openerEntry: RosterEntry = {
    uid:          userId,
    username,
    full_name:    cashierName,
    role,
    clock_in_at:  now,
    clock_out_at: null,
    status:       'active',
  };
  const openEvent: CashierEvent = {
    uid:       userId,
    username,
    full_name: cashierName,
    role,
    action:    'open',
    at:        now,
  };

  const session: CashSession = {
    id:                   uuid(),
    user_id:              userId,
    cashier_name:         cashierName,
    start_time:           now,
    end_time:             null,
    starting_cash:        startingCash,
    expected_cash:        null,
    actual_cash:          null,
    difference:           null,
    status:               'open',
    cash_collected:       0,
    opened_by_uid:        userId,
    opened_by_name:       cashierName,
    active_cashier_uid:   userId,
    active_cashier_name:  cashierName,
    roster:               [openerEntry],
    cashier_log:          [openEvent],
  };
  await saveSessionCache(session, userId, true);
  return session;
}

// ─── Pending cashier roster sync (offline clock-in / switch / clock-out) ─────

export interface PendingCashierSync {
  sessionId:   string;
  roster:      RosterEntry[];
  activeUid:   string;
  activeName:  string;
  newEvents:   CashierEvent[];
}

const PENDING_CASHIER_SYNC_KEY = '@smartbrew:pending_cashier_sync';

export async function savePendingCashierSync(data: PendingCashierSync): Promise<void> {
  await AsyncStorage.setItem(PENDING_CASHIER_SYNC_KEY, JSON.stringify(data));
}

export async function loadPendingCashierSync(): Promise<PendingCashierSync | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_CASHIER_SYNC_KEY);
    return raw ? (JSON.parse(raw) as PendingCashierSync) : null;
  } catch {
    return null;
  }
}

export async function clearPendingCashierSync(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_CASHIER_SYNC_KEY);
}
