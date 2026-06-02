import { updateDoc, arrayUnion } from 'firebase/firestore';
import {
  addCashierToRoster,
  switchActiveCashier,
  clockOutCashierEntry,
  clockOutAllActiveCashiers,
} from '../firestoreService';
import type { AuthUser, RosterEntry } from '../../types';

const mockUpdateDoc  = updateDoc  as jest.Mock;
const mockArrayUnion = arrayUnion as jest.Mock;

// ─── Factories ────────────────────────────────────────────────────────────────

function user(uid: string, name: string): AuthUser {
  return { uid, username: uid, full_name: name, role: 'cashier' };
}

function entry(uid: string, name: string, status: 'active' | 'clocked_out' = 'active'): RosterEntry {
  return {
    uid, username: uid, full_name: name, role: 'cashier',
    clock_in_at:  '2026-06-01T08:00:00.000Z',
    clock_out_at: status === 'clocked_out' ? '2026-06-01T12:00:00.000Z' : null,
    status,
  };
}

const NOW = '2026-06-01T10:00:00.000Z';

// ─── addCashierToRoster ───────────────────────────────────────────────────────

describe('addCashierToRoster', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
  });
  afterEach(() => jest.useRealTimers());

  it('appends a new active entry to the roster', async () => {
    const { roster } = await addCashierToRoster(
      'session123', user('ben', 'Ben'), user('anna', 'Anna'), [entry('anna', 'Anna')],
    );

    expect(roster).toHaveLength(2);
    expect(roster[1]).toMatchObject({
      uid: 'ben', full_name: 'Ben',
      status: 'active', clock_in_at: NOW, clock_out_at: null,
    });
  });

  it('does not mutate the input roster array', async () => {
    const original = [entry('anna', 'Anna')];
    await addCashierToRoster('session123', user('ben', 'Ben'), user('anna', 'Anna'), original);
    expect(original).toHaveLength(1);
  });

  it('emits switch_out for prev then clock_in for new', async () => {
    const { log } = await addCashierToRoster(
      'session123', user('ben', 'Ben'), user('anna', 'Anna'), [entry('anna', 'Anna')],
    );

    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ uid: 'anna', action: 'switch_out', at: NOW });
    expect(log[1]).toMatchObject({ uid: 'ben',  action: 'clock_in',   at: NOW });
  });

  it('calls updateDoc exactly once for real session ids', async () => {
    await addCashierToRoster('realSessionId', user('ben', 'Ben'), user('anna', 'Anna'), [entry('anna', 'Anna')]);
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
  });

  it('skips updateDoc for draft session ids (contain hyphens)', async () => {
    await addCashierToRoster('draft-uuid-1234', user('ben', 'Ben'), user('anna', 'Anna'), [entry('anna', 'Anna')]);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('writes updated roster + active fields to Firestore', async () => {
    await addCashierToRoster('session123', user('ben', 'Ben'), user('anna', 'Anna'), [entry('anna', 'Anna')]);

    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        active_cashier_uid:  'ben',
        active_cashier_name: 'Ben',
        roster: expect.arrayContaining([
          expect.objectContaining({ uid: 'anna' }),
          expect.objectContaining({ uid: 'ben', status: 'active' }),
        ]),
      }),
    );
  });
});

// ─── switchActiveCashier ──────────────────────────────────────────────────────

describe('switchActiveCashier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
  });
  afterEach(() => jest.useRealTimers());

  it('returns [switch_out, switch_in] in that order', async () => {
    const events = await switchActiveCashier('session123', user('anna', 'Anna'), user('ben', 'Ben'));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ uid: 'anna', action: 'switch_out', at: NOW });
    expect(events[1]).toMatchObject({ uid: 'ben',  action: 'switch_in',  at: NOW });
  });

  it('writes active_cashier_uid + active_cashier_name to Firestore', async () => {
    await switchActiveCashier('session123', user('anna', 'Anna'), user('ben', 'Ben'));

    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        active_cashier_uid:  'ben',
        active_cashier_name: 'Ben',
      }),
    );
  });

  it('appends both events via arrayUnion', async () => {
    await switchActiveCashier('session123', user('anna', 'Anna'), user('ben', 'Ben'));

    expect(mockArrayUnion).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'switch_out' }),
      expect.objectContaining({ action: 'switch_in' }),
    );
  });

  it('skips updateDoc for draft session ids', async () => {
    await switchActiveCashier('draft-uuid-x', user('anna', 'Anna'), user('ben', 'Ben'));
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

// ─── clockOutCashierEntry ─────────────────────────────────────────────────────

describe('clockOutCashierEntry', () => {
  const CLOCK_OUT = '2026-06-01T14:00:00.000Z';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(CLOCK_OUT));
  });
  afterEach(() => jest.useRealTimers());

  it('sets status to clocked_out and fills clock_out_at', async () => {
    const { roster } = await clockOutCashierEntry('session123', 'anna', [entry('anna', 'Anna'), entry('ben', 'Ben')]);

    const anna = roster.find((e) => e.uid === 'anna')!;
    expect(anna.status).toBe('clocked_out');
    expect(anna.clock_out_at).toBe(CLOCK_OUT);
  });

  it('does not affect other roster entries', async () => {
    const { roster } = await clockOutCashierEntry('session123', 'anna', [entry('anna', 'Anna'), entry('ben', 'Ben')]);

    const ben = roster.find((e) => e.uid === 'ben')!;
    expect(ben.status).toBe('active');
    expect(ben.clock_out_at).toBeNull();
  });

  it('emits exactly one clock_out event for the right uid', async () => {
    const { log } = await clockOutCashierEntry('session123', 'anna', [entry('anna', 'Anna')]);

    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ uid: 'anna', action: 'clock_out', at: CLOCK_OUT });
  });

  it('is a no-op for unknown uid — returns unchanged roster and empty log', async () => {
    const original = [entry('anna', 'Anna')];
    const { roster, log } = await clockOutCashierEntry('session123', 'nobody', original);

    expect(roster).toEqual(original);
    expect(log).toHaveLength(0);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('skips updateDoc for draft session ids', async () => {
    await clockOutCashierEntry('draft-uuid-x', 'anna', [entry('anna', 'Anna')]);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

// ─── clockOutAllActiveCashiers ────────────────────────────────────────────────

describe('clockOutAllActiveCashiers', () => {
  const SHIFT_END = '2026-06-01T18:00:00.000Z';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(SHIFT_END));
  });
  afterEach(() => jest.useRealTimers());

  it('marks every active entry as clocked_out', async () => {
    await clockOutAllActiveCashiers('session123', [entry('anna', 'Anna'), entry('ben', 'Ben')]);

    const updateArg = mockUpdateDoc.mock.calls[0][1];
    expect(updateArg.roster).toHaveLength(2);
    expect(updateArg.roster[0]).toMatchObject({ uid: 'anna', status: 'clocked_out', clock_out_at: SHIFT_END });
    expect(updateArg.roster[1]).toMatchObject({ uid: 'ben',  status: 'clocked_out', clock_out_at: SHIFT_END });
  });

  it('does not call updateDoc when roster is empty', async () => {
    await clockOutAllActiveCashiers('session123', []);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('does not call updateDoc when all entries are already clocked out', async () => {
    await clockOutAllActiveCashiers('session123', [entry('anna', 'Anna', 'clocked_out')]);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('passes one clock_out event per active cashier to arrayUnion', async () => {
    await clockOutAllActiveCashiers('session123', [entry('anna', 'Anna'), entry('ben', 'Ben')]);

    const spreadArgs = mockArrayUnion.mock.calls[0];
    expect(spreadArgs).toHaveLength(2);
    expect(spreadArgs[0]).toMatchObject({ uid: 'anna', action: 'clock_out' });
    expect(spreadArgs[1]).toMatchObject({ uid: 'ben',  action: 'clock_out' });
  });

  it('does not change already-clocked-out entries', async () => {
    const alreadyOut = entry('carla', 'Carla', 'clocked_out');
    await clockOutAllActiveCashiers('session123', [entry('anna', 'Anna'), alreadyOut]);

    const updateArg = mockUpdateDoc.mock.calls[0][1];
    const carla = updateArg.roster.find((e: RosterEntry) => e.uid === 'carla')!;
    expect(carla.clock_out_at).toBe(alreadyOut.clock_out_at); // unchanged
  });

  it('skips updateDoc for draft session ids', async () => {
    await clockOutAllActiveCashiers('draft-uuid-x', [entry('anna', 'Anna')]);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});
