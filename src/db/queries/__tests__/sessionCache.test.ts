// These tests import the REAL sessionCache module (not mocked).
// jest.setup.ts mocks sessionCache for OTHER test suites; this suite bypasses
// that by declaring its own jest.mock calls first — Jest hoists them above the import.
// Bypass the global sessionCache mock from jest.setup.ts so we can test the real code.
jest.unmock('../sessionCache');

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveSessionCache,
  loadSessionCache,
  clearSessionCache,
  openSessionOffline,
  savePendingCashierSync,
  loadPendingCashierSync,
  clearPendingCashierSync,
} from '../sessionCache';
import type { CashSession, PendingCashierSync } from '../../../types';

const USER_KEY     = '@smartbrew:session_cache:anna-uid';
const REGISTER_KEY = '@smartbrew:session_cache:register';

const baseSession: CashSession = {
  id:            'session-abc',
  user_id:       'anna-uid',
  cashier_name:  'Anna',
  start_time:    '2026-06-01T08:00:00.000Z',
  end_time:      null,
  starting_cash: 1000,
  expected_cash: null,
  actual_cash:   null,
  difference:    null,
  status:        'open',
};

const mockGet    = AsyncStorage.getItem    as jest.Mock;
const mockSet    = AsyncStorage.setItem    as jest.Mock;
const mockRemove = AsyncStorage.removeItem as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockSet.mockResolvedValue(undefined);
  mockRemove.mockResolvedValue(undefined);
});

// ─── saveSessionCache ─────────────────────────────────────────────────────────

describe('saveSessionCache', () => {
  it('writes to both the user key and the register key', async () => {
    await saveSessionCache(baseSession, 'anna-uid');

    const writtenKeys = mockSet.mock.calls.map(([k]: [string]) => k);
    expect(writtenKeys).toContain(USER_KEY);
    expect(writtenKeys).toContain(REGISTER_KEY);
  });

  it('writes the same JSON payload to both keys', async () => {
    await saveSessionCache(baseSession, 'anna-uid', true);

    const values = mockSet.mock.calls.map(([, v]: [string, string]) => v);
    expect(values[0]).toBe(values[1]);
  });

  it('wraps the session in an entry with isDraft', async () => {
    await saveSessionCache(baseSession, 'anna-uid', true);

    const payload = JSON.parse(mockSet.mock.calls[0][1]);
    expect(payload).toMatchObject({ session: { id: 'session-abc' }, isDraft: true });
  });
});

// ─── loadSessionCache ─────────────────────────────────────────────────────────

describe('loadSessionCache', () => {
  function makeEntry(session: CashSession, isDraft = false) {
    return JSON.stringify({ session, isDraft });
  }

  it('returns data from the user-specific key when present', async () => {
    mockGet.mockImplementation((key: string) =>
      key === USER_KEY ? Promise.resolve(makeEntry(baseSession)) : Promise.resolve(null),
    );

    const result = await loadSessionCache('anna-uid');
    expect(result?.session.id).toBe('session-abc');
    expect(result?.isDraft).toBe(false);
  });

  it('falls back to the register key when the user key misses (cross-login)', async () => {
    mockGet.mockImplementation((key: string) =>
      key === REGISTER_KEY ? Promise.resolve(makeEntry(baseSession)) : Promise.resolve(null),
    );

    const result = await loadSessionCache('ben-uid'); // different user
    expect(result?.session.id).toBe('session-abc');
  });

  it('returns null when both keys miss', async () => {
    mockGet.mockResolvedValue(null);
    expect(await loadSessionCache('nobody')).toBeNull();
  });

  it('handles the old bare-CashSession format (backwards compat)', async () => {
    mockGet.mockImplementation((key: string) =>
      key === USER_KEY ? Promise.resolve(JSON.stringify(baseSession)) : Promise.resolve(null),
    );

    const result = await loadSessionCache('anna-uid');
    expect(result?.isDraft).toBe(false);
    expect(result?.session.id).toBe('session-abc');
  });

  it('returns null on JSON parse error', async () => {
    mockGet.mockImplementation((key: string) =>
      key === USER_KEY ? Promise.resolve('NOT_VALID_JSON{') : Promise.resolve(null),
    );

    expect(await loadSessionCache('anna-uid')).toBeNull();
  });
});

// ─── clearSessionCache ────────────────────────────────────────────────────────

describe('clearSessionCache', () => {
  it('removes both user and register keys by default', async () => {
    await clearSessionCache('anna-uid');

    const removed = mockRemove.mock.calls.map(([k]: [string]) => k);
    expect(removed).toContain(USER_KEY);
    expect(removed).toContain(REGISTER_KEY);
  });

  it('removes only the user key when keepRegister=true (logout path)', async () => {
    await clearSessionCache('anna-uid', { keepRegister: true });

    const removed = mockRemove.mock.calls.map(([k]: [string]) => k);
    expect(removed).toContain(USER_KEY);
    expect(removed).not.toContain(REGISTER_KEY);
  });

  it('works for any user id', async () => {
    await clearSessionCache('ben-uid');

    const removed = mockRemove.mock.calls.map(([k]: [string]) => k);
    expect(removed).toContain('@smartbrew:session_cache:ben-uid');
  });
});

// ─── openSessionOffline ───────────────────────────────────────────────────────

describe('openSessionOffline', () => {
  const NOW = '2026-06-01T08:00:00.000Z';

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
  });
  afterEach(() => jest.useRealTimers());

  it('creates a session with a uuid id (contains hyphens = draft)', async () => {
    const session = await openSessionOffline('anna-uid', 'Anna', 500);
    expect(session.id).toMatch(/-/);
  });

  it('seeds a one-entry roster with the opener', async () => {
    const session = await openSessionOffline('anna-uid', 'Anna', 500, { username: 'anna', role: 'cashier' });

    expect(session.roster).toHaveLength(1);
    expect(session.roster![0]).toMatchObject({
      uid: 'anna-uid', full_name: 'Anna',
      status: 'active', clock_in_at: NOW, clock_out_at: null,
    });
  });

  it('seeds one open log event', async () => {
    const session = await openSessionOffline('anna-uid', 'Anna', 500);

    expect(session.cashier_log).toHaveLength(1);
    expect(session.cashier_log![0].action).toBe('open');
  });

  it('stamps opened_by_uid and opened_by_name', async () => {
    const session = await openSessionOffline('anna-uid', 'Anna', 500);

    expect(session.opened_by_uid).toBe('anna-uid');
    expect(session.opened_by_name).toBe('Anna');
  });

  it('saves to both user and register cache keys', async () => {
    await openSessionOffline('anna-uid', 'Anna', 500);

    const written = mockSet.mock.calls.map(([k]: [string]) => k);
    expect(written).toContain(USER_KEY);
    expect(written).toContain(REGISTER_KEY);
  });

  it('applies userInfo role and username when provided', async () => {
    const session = await openSessionOffline('mgr-uid', 'Manager', 0, { username: 'mgr', role: 'manager' });

    expect(session.roster![0].role).toBe('manager');
    expect(session.roster![0].username).toBe('mgr');
  });
});

// ─── Pending cashier sync buffer ──────────────────────────────────────────────

describe('pending cashier sync buffer', () => {
  const SYNC_KEY = '@smartbrew:pending_cashier_sync';

  const mockSync: PendingCashierSync = {
    sessionId:  'session-123',
    roster:     [],
    activeUid:  'anna-uid',
    activeName: 'Anna',
    newEvents:  [],
  };

  it('savePendingCashierSync writes the data under the correct key', async () => {
    await savePendingCashierSync(mockSync);

    expect(mockSet).toHaveBeenCalledWith(SYNC_KEY, JSON.stringify(mockSync));
  });

  it('loadPendingCashierSync returns the saved data', async () => {
    mockGet.mockImplementation((key: string) =>
      key === SYNC_KEY ? Promise.resolve(JSON.stringify(mockSync)) : Promise.resolve(null),
    );

    const result = await loadPendingCashierSync();
    expect(result?.sessionId).toBe('session-123');
    expect(result?.activeUid).toBe('anna-uid');
  });

  it('loadPendingCashierSync returns null when nothing queued', async () => {
    mockGet.mockResolvedValue(null);
    expect(await loadPendingCashierSync()).toBeNull();
  });

  it('clearPendingCashierSync removes the key', async () => {
    await clearPendingCashierSync();
    expect(mockRemove).toHaveBeenCalledWith(SYNC_KEY);
  });
});
