/**
 * Regression tests for the POS sign-out bugs fixed in June 2026.
 *
 * Bug A — "signs out other cashiers":
 *   doSignOut() called logout() without first clocking out the current cashier,
 *   leaving their entry stuck as 'active'. Because the session state was corrupted
 *   (wrong active_cashier_uid), subsequent SessionGate calls to addCashierToRoster
 *   would overwrite the Firestore roster with a stale copy, inadvertently clearing
 *   other cashiers' entries.
 *
 * Bug B — "redirected to login when other cashiers are active":
 *   doSignOut() always called logout() (→ Firebase signOut + navigate to login).
 *   When other cashiers were still active on the session the correct behaviour is
 *   to hand the register off to the next active cashier and stay on POS.
 *
 * Fix:
 *   doSignOut() now:
 *     1. Calls clockOutCashierEntry() for the signing-out cashier only.
 *     2. If another active cashier exists → handoff (no logout, stay on POS).
 *     3. If no other active cashiers → call logout() to send the device to login.
 *
 * These tests verify the service-layer contracts the fix depends on, plus the
 * handoff-detection logic that drives the component-level decision.
 */

import { updateDoc, arrayUnion } from 'firebase/firestore';
import { clockOutCashierEntry } from '../firestoreService';
import type { RosterEntry } from '../../types';

const mockUpdateDoc  = updateDoc  as jest.Mock;
const mockArrayUnion = arrayUnion as jest.Mock;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW       = '2026-06-01T10:00:00.000Z';
const CLOCK_OUT = '2026-06-01T14:00:00.000Z';

function active(uid: string, name = uid): RosterEntry {
  return {
    uid, username: uid, full_name: name, role: 'cashier',
    clock_in_at:  NOW,
    clock_out_at: null,
    status:       'active',
  };
}

function clocked(uid: string, name = uid): RosterEntry {
  return {
    uid, username: uid, full_name: name, role: 'cashier',
    clock_in_at:  NOW,
    clock_out_at: CLOCK_OUT,
    status:       'clocked_out',
  };
}

/**
 * Mimics the handoff-detection logic from doSignOut():
 *   const nextCashier = updatedRoster.find(e => e.uid !== signingOutUid && e.status === 'active');
 */
function findHandoffCashier(
  roster: RosterEntry[],
  signingOutUid: string,
): RosterEntry | undefined {
  return roster.find((e) => e.uid !== signingOutUid && e.status === 'active');
}

// ─── Bug A regression: isolation ──────────────────────────────────────────────

describe('sign-out isolation — Bug A regression', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(CLOCK_OUT));
  });
  afterEach(() => jest.useRealTimers());

  it('clocks out only the signing-out cashier; all others stay active', async () => {
    const roster = [active('anna'), active('ben'), active('carla')];
    const { roster: updated } = await clockOutCashierEntry('session123', 'anna', roster);

    const anna  = updated.find((e) => e.uid === 'anna')!;
    const ben   = updated.find((e) => e.uid === 'ben')!;
    const carla = updated.find((e) => e.uid === 'carla')!;

    expect(anna.status).toBe('clocked_out');
    expect(ben.status).toBe('active');
    expect(carla.status).toBe('active');
  });

  it('does not set clock_out_at on cashiers who did not sign out', async () => {
    const roster = [active('anna'), active('ben')];
    const { roster: updated } = await clockOutCashierEntry('session123', 'anna', roster);

    const ben = updated.find((e) => e.uid === 'ben')!;
    expect(ben.clock_out_at).toBeNull();
  });

  it('the Firestore write preserves all roster entries (none dropped)', async () => {
    const roster = [active('anna'), active('ben'), clocked('carla')];
    await clockOutCashierEntry('session123', 'anna', roster);

    const writtenRoster = mockUpdateDoc.mock.calls[0][1].roster as RosterEntry[];
    expect(writtenRoster).toHaveLength(3);
    expect(writtenRoster.map((e) => e.uid)).toEqual(
      expect.arrayContaining(['anna', 'ben', 'carla']),
    );
  });

  it('emits a clock_out event only for the signing-out cashier', async () => {
    const roster = [active('anna'), active('ben')];
    const { log } = await clockOutCashierEntry('session123', 'anna', roster);

    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ uid: 'anna', action: 'clock_out' });
  });

  it('does NOT emit a clock_out event for other active cashiers', async () => {
    const roster = [active('anna'), active('ben'), active('carla')];
    const { log } = await clockOutCashierEntry('session123', 'anna', roster);

    const otherEvents = log.filter((e) => e.uid !== 'anna');
    expect(otherEvents).toHaveLength(0);
  });

  it('works correctly for a draft session (no Firestore write)', async () => {
    const roster = [active('anna'), active('ben')];
    const { roster: updated } = await clockOutCashierEntry('draft-uuid-x', 'anna', roster);

    expect(mockUpdateDoc).not.toHaveBeenCalled();

    const anna = updated.find((e) => e.uid === 'anna')!;
    const ben  = updated.find((e) => e.uid === 'ben')!;
    expect(anna.status).toBe('clocked_out');
    expect(ben.status).toBe('active');
  });
});

// ─── Bug B regression: handoff detection ──────────────────────────────────────

describe('sign-out handoff detection — Bug B regression', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(CLOCK_OUT));
  });
  afterEach(() => jest.useRealTimers());

  it('returns the next active cashier when one exists (no logout needed)', async () => {
    const roster = [active('anna'), active('ben')];
    const { roster: updated } = await clockOutCashierEntry('session123', 'anna', roster);

    const handoff = findHandoffCashier(updated, 'anna');
    expect(handoff).toBeDefined();
    expect(handoff!.uid).toBe('ben');
    expect(handoff!.status).toBe('active');
  });

  it('returns the first active cashier when multiple others are active', async () => {
    const roster = [active('anna'), active('ben'), active('carla')];
    const { roster: updated } = await clockOutCashierEntry('session123', 'anna', roster);

    const handoff = findHandoffCashier(updated, 'anna');
    expect(handoff).toBeDefined();
    // Both ben and carla are active; we just need a valid handoff target
    expect(['ben', 'carla']).toContain(handoff!.uid);
  });

  it('returns undefined when the signing-out cashier is the last active one (logout required)', async () => {
    const roster = [active('anna'), clocked('ben')];
    const { roster: updated } = await clockOutCashierEntry('session123', 'anna', roster);

    const handoff = findHandoffCashier(updated, 'anna');
    expect(handoff).toBeUndefined();
  });

  it('returns undefined for a single-cashier session (logout required)', async () => {
    const roster = [active('anna')];
    const { roster: updated } = await clockOutCashierEntry('session123', 'anna', roster);

    const handoff = findHandoffCashier(updated, 'anna');
    expect(handoff).toBeUndefined();
  });

  it('never returns the signing-out cashier as the handoff target', async () => {
    const roster = [active('anna'), active('anna'), active('ben')]; // duplicate uid edge-case
    const { roster: updated } = await clockOutCashierEntry('session123', 'anna', roster);

    const handoff = findHandoffCashier(updated, 'anna');
    if (handoff) {
      expect(handoff.uid).not.toBe('anna');
    }
  });

  it('does not consider already-clocked-out cashiers as handoff candidates', async () => {
    const roster = [active('anna'), clocked('ben'), clocked('carla')];
    const { roster: updated } = await clockOutCashierEntry('session123', 'anna', roster);

    const handoff = findHandoffCashier(updated, 'anna');
    expect(handoff).toBeUndefined(); // ben and carla are clocked_out, no valid handoff
  });
});

// ─── Firestore write correctness ──────────────────────────────────────────────

describe('clockOutCashierEntry Firestore write during sign-out', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(CLOCK_OUT));
  });
  afterEach(() => jest.useRealTimers());

  it('writes the correct clock_out_at timestamp for the signing-out cashier', async () => {
    await clockOutCashierEntry('session123', 'anna', [active('anna'), active('ben')]);

    const writtenRoster = mockUpdateDoc.mock.calls[0][1].roster as RosterEntry[];
    const anna = writtenRoster.find((e) => e.uid === 'anna')!;
    expect(anna.clock_out_at).toBe(CLOCK_OUT);
  });

  it('passes the clock_out event through arrayUnion (not a full overwrite of cashier_log)', async () => {
    await clockOutCashierEntry('session123', 'anna', [active('anna')]);

    expect(mockArrayUnion).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'anna', action: 'clock_out', at: CLOCK_OUT }),
    );
  });

  it('does not change the active cashier uid/name fields (caller handles handoff)', async () => {
    await clockOutCashierEntry('session123', 'anna', [active('anna'), active('ben')]);

    const writePayload = mockUpdateDoc.mock.calls[0][1];
    // clockOutCashierEntry only touches `roster` and `cashier_log`,
    // NOT active_cashier_uid or active_cashier_name — that's persistRoster's job
    expect(writePayload).not.toHaveProperty('active_cashier_uid');
    expect(writePayload).not.toHaveProperty('active_cashier_name');
  });
});
