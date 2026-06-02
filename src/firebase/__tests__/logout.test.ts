/**
 * Regression tests for the Sign Out silent-failure bug.
 *
 * Root cause: Firebase's signOut(auth) is a no-op when auth.currentUser is
 * already null (happens when the token expired while the user was offline).
 * In that case onAuthStateChanged never fires, so setUser(null) is never
 * called, and navigation to the login screen never happens.
 *
 * Fix: logout() explicitly calls useAuthStore.getState().setUser(null) after
 * clearing caches, guaranteeing navigation regardless of Firebase's behaviour.
 */

import { signOut } from 'firebase/auth';
import { logout } from '../auth';

const mockSignOut = signOut as jest.Mock;

// The global jest.setup.ts already mocks firebase/auth — this override just
// ensures signOut is a fresh jest.fn() we can reconfigure per test.
// (no jest.requireActual — Firebase ESM can't be loaded in Jest without native transform)

// Override the authStore mock so we can spy on setUser calls.
// We expose a mock setUser via getState() which is what logout() calls.
const mockSetUser = jest.fn();

jest.mock('../../store/authStore', () => ({
  useAuthStore: Object.assign(
    jest.fn(),
    { getState: jest.fn(() => ({ setUser: mockSetUser })) },
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────

describe('logout() — Sign Out reliability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignOut.mockResolvedValue(undefined);
  });

  it('calls setUser(null) after a normal sign-out', async () => {
    await logout();
    expect(mockSetUser).toHaveBeenCalledWith(null);
  });

  it('calls setUser(null) even when signOut() resolves as a no-op (expired-token reproduction)', async () => {
    // Simulate the exact reproduction scenario:
    // auth.currentUser is already null (token expired), signOut resolves but
    // fires no onAuthStateChanged callback. Without the fix, setUser(null) was
    // never called and the user stayed stuck on the POS screen.
    mockSignOut.mockResolvedValue(undefined);

    await logout();

    expect(mockSetUser).toHaveBeenCalledWith(null);
  });

  it('calls setUser(null) even when signOut() throws (network error)', async () => {
    mockSignOut.mockRejectedValue(new Error('network-request-failed'));

    await logout();

    // signOut failure is logged and swallowed; local state must still clear
    expect(mockSetUser).toHaveBeenCalledWith(null);
  });

  it('clears the auth cache before calling signOut', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const removeMock = AsyncStorage.removeItem as jest.Mock;
    removeMock.mockClear();

    await logout();

    // removeItem (clearAuthCache) must complete BEFORE signOut fires
    const removeOrder  = removeMock.mock.invocationCallOrder[0]  ?? 0;
    const signOutOrder = mockSignOut.mock.invocationCallOrder[0] ?? 0;
    expect(removeOrder).toBeLessThan(signOutOrder);
  });

  it('calls setUser(null) exactly once per logout', async () => {
    await logout();
    expect(mockSetUser).toHaveBeenCalledTimes(1);
    expect(mockSetUser).toHaveBeenCalledWith(null);
  });
});
