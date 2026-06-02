import { addDoc, updateDoc } from 'firebase/firestore';
import { openSession, closeSession } from '../firestoreService';

const mockAddDoc   = addDoc   as jest.Mock;
const mockUpdateDoc = updateDoc as jest.Mock;

const NOW = '2026-06-01T08:00:00.000Z';

// ─── openSession ──────────────────────────────────────────────────────────────

describe('openSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
    mockAddDoc.mockResolvedValue({ id: 'new-session-id' });
  });
  afterEach(() => jest.useRealTimers());

  // ── Roster seeding ──────────────────────────────────────────────────────────

  it('creates a one-entry roster with the opener as active', async () => {
    const session = await openSession('anna-uid', 'Anna', 1000, undefined, { username: 'anna', role: 'cashier' });

    expect(session.roster).toHaveLength(1);
    expect(session.roster![0]).toMatchObject({
      uid:          'anna-uid',
      full_name:    'Anna',
      username:     'anna',
      role:         'cashier',
      status:       'active',
      clock_in_at:  NOW,
      clock_out_at: null,
    });
  });

  it('seeds a single open log event', async () => {
    const session = await openSession('anna-uid', 'Anna', 1000);

    expect(session.cashier_log).toHaveLength(1);
    expect(session.cashier_log![0]).toMatchObject({ uid: 'anna-uid', action: 'open', at: NOW });
  });

  // ── Opener / closer stamps ──────────────────────────────────────────────────

  it('stamps opened_by_uid and opened_by_name', async () => {
    const session = await openSession('anna-uid', 'Anna', 1000);

    expect(session.opened_by_uid).toBe('anna-uid');
    expect(session.opened_by_name).toBe('Anna');
  });

  it('leaves closed_by_uid and closed_by_name null', async () => {
    const session = await openSession('anna-uid', 'Anna', 1000);

    expect(session.closed_by_uid).toBeNull();
    expect(session.closed_by_name).toBeNull();
  });

  // ── Active cashier fields ───────────────────────────────────────────────────

  it('sets active_cashier to the opener', async () => {
    const session = await openSession('anna-uid', 'Anna', 1000);

    expect(session.active_cashier_uid).toBe('anna-uid');
    expect(session.active_cashier_name).toBe('Anna');
  });

  // ── userInfo fallback ───────────────────────────────────────────────────────

  it('falls back to empty username and cashier role when userInfo is absent', async () => {
    const session = await openSession('anna-uid', 'Anna', 1000);

    expect(session.roster![0].username).toBe('');
    expect(session.roster![0].role).toBe('cashier');
  });

  it('uses the role from userInfo when provided', async () => {
    const session = await openSession('mgr-uid', 'Manager', 0, undefined, { username: 'mgr', role: 'manager' });

    expect(session.roster![0].role).toBe('manager');
    expect(session.roster![0].username).toBe('mgr');
  });

  // ── Return value ────────────────────────────────────────────────────────────

  it('returns a CashSession with the Firestore doc id', async () => {
    const session = await openSession('anna-uid', 'Anna', 1000);
    expect(session.id).toBe('new-session-id');
  });

  it('returns starting_cash matching the argument', async () => {
    const session = await openSession('anna-uid', 'Anna', 2500);
    expect(session.starting_cash).toBe(2500);
  });

  it('returns status open and cash_collected 0', async () => {
    const session = await openSession('anna-uid', 'Anna', 1000);

    expect(session.status).toBe('open');
    expect(session.cash_collected).toBe(0);
  });
});

// ─── closeSession ─────────────────────────────────────────────────────────────

describe('closeSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateDoc.mockResolvedValue(undefined);
  });

  // ── Closer identity ─────────────────────────────────────────────────────────

  it('writes closed_by_uid and closed_by_name when closerInfo is provided', async () => {
    await closeSession('session123', 1200, 1200, 'ben-uid', { uid: 'ben-uid', name: 'Ben' });

    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ closed_by_uid: 'ben-uid', closed_by_name: 'Ben' }),
    );
  });

  it('does NOT write closed_by fields when closerInfo is absent (back-compat)', async () => {
    await closeSession('session123', 1200, 1200, 'anna-uid');

    const arg = mockUpdateDoc.mock.calls[0][1];
    expect(arg).not.toHaveProperty('closed_by_uid');
    expect(arg).not.toHaveProperty('closed_by_name');
  });

  // ── Cash reconciliation math ────────────────────────────────────────────────

  it('computes difference = actual − expected', async () => {
    await closeSession('session123', 1250, 1200, 'anna-uid');

    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ difference: 50 }),
    );
  });

  it('records a negative difference when actual < expected', async () => {
    await closeSession('session123', 1100, 1200, 'anna-uid');

    const arg = mockUpdateDoc.mock.calls[0][1];
    expect(arg.difference).toBe(-100);
  });

  it('records zero difference when balanced', async () => {
    await closeSession('session123', 1200, 1200, 'anna-uid');

    const arg = mockUpdateDoc.mock.calls[0][1];
    expect(arg.difference).toBe(0);
  });

  // ── Status & timing ─────────────────────────────────────────────────────────

  it('sets status to closed', async () => {
    await closeSession('session123', 1200, 1200, 'anna-uid');

    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'closed' }),
    );
  });

  it('writes end_time as an ISO string', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-01T18:00:00.000Z'));

    await closeSession('session123', 1200, 1200, 'anna-uid');

    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ end_time: '2026-06-01T18:00:00.000Z' }),
    );
    jest.useRealTimers();
  });

  // ── Opener ≠ closer scenario ────────────────────────────────────────────────

  it('records Ben as closer even when Anna was the opener', async () => {
    await closeSession('session123', 1200, 1200, 'ben-uid', { uid: 'ben-uid', name: 'Ben' });

    const arg = mockUpdateDoc.mock.calls[0][1];
    expect(arg.closed_by_uid).toBe('ben-uid');
    expect(arg.closed_by_name).toBe('Ben');
    // opened_by is not touched by closeSession
    expect(arg).not.toHaveProperty('opened_by_uid');
  });
});
