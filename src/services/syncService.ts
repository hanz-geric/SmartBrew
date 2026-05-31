import {
  getPendingOrders, getPendingOrderById, removePendingOrder,
  incrementRetry, patchPendingOrdersSessionId,
} from '../db/queries/queue';
import { saveFailedOrder } from '../db/queries/failedOrders';
import { createOrder, openSession } from '../firebase/firestoreService';
import { updateDoc, increment } from 'firebase/firestore';
import { sessionDoc } from '../firebase/collections';
import { saveSessionCache, loadPendingClose, clearPendingClose } from '../db/queries/sessionCache';
import { auth } from '../firebase/config';
import { AuthUser, CashSession } from '../types';
import { logError } from '../utils/logger';

const MAX_RETRIES = 5;

// Module-level lock — prevents concurrent sync runs that would duplicate orders
let syncInProgress = false;

export interface SyncResult {
  synced:      number;
  failed:      number;
  deadLettered: number;
}

export async function syncPendingOrders(
  session: CashSession,
  user:    AuthUser,
): Promise<SyncResult> {
  if (syncInProgress) {
    console.log('[syncService] Sync already in progress — skipping concurrent call');
    return { synced: 0, failed: 0, deadLettered: 0 };
  }
  syncInProgress = true;

  const cu = auth.currentUser;
  console.log(`[syncService] Syncing as uid=${cu?.uid ?? 'NOT SIGNED IN'} email=${cu?.email ?? 'n/a'}`);

  let activeSession = session;
  let pending       = await getPendingOrders();
  let synced        = 0;
  let failed        = 0;
  let deadLettered  = 0;

  // If any queued order references a draft UUID session, reconcile it first so
  // the orders get a real Firestore session_id after patching.
  const hasDraftOrders = pending.some((o) => o.payload.session_id?.includes('-'));
  if (hasDraftOrders) {
    const draftSessionId = pending.find((o) => o.payload.session_id?.includes('-'))
      ?.payload.session_id;
    const sessionToReconcile = activeSession.id === draftSessionId
      ? activeSession
      : { ...activeSession, id: draftSessionId! };

    try {
      console.log(`[syncService] Reconciling draft session ${draftSessionId} before sync`);
      const real = await reconcileDraftSession(sessionToReconcile as CashSession, user);
      activeSession = real;
      // Re-fetch pending orders — reconcile patched their session_ids in SQLite
      pending = await getPendingOrders();
    } catch (err) {
      logError('syncService:preReconcile', err,
        `Pre-sync reconciliation failed for draft ${draftSessionId} — orders will sync with orphaned session_id`);
    }
  }

  let syncedCashTotal = 0;

  try {
    for (const item of pending) {
      if (item.retry_count >= MAX_RETRIES) {
        await saveFailedOrder(item);
        await removePendingOrder(item.local_id);
        deadLettered++;
        continue;
      }
      try {
        const effectiveSession: CashSession = item.payload.session_id
          ? { ...activeSession, id: item.payload.session_id }
          : activeSession;
        // Pass local_id so createOrder uses it as the Firestore doc ID — this
        // makes sync idempotent: a double-sync overwrites the same document
        // instead of creating a duplicate.
        await createOrder(item.payload, effectiveSession, user, item.local_id);
        await removePendingOrder(item.local_id);
        synced++;

        // Track cash collected from offline orders so we can update the real
        // Firestore session after the loop (createOrder skips cash updates
        // for draft UUID session IDs to avoid "No document to update" errors).
        if (item.payload.payment_method === 'cash') {
          const subtotal = item.payload.cart_snapshot.reduce(
            (s, i) => s + i.unit_price * i.quantity, 0,
          );
          syncedCashTotal += Math.max(0, subtotal - (item.payload.discount_amount ?? 0));
        }
      } catch (err) {
        await logError('syncService:syncPendingOrders', err, `Failed to sync order ${item.local_id}`);
        await incrementRetry(item.local_id);
        failed++;
      }
    }

    // Consolidated cash_collected update on the real Firestore session.
    // Only runs when activeSession is a real document (no hyphens in ID).
    if (syncedCashTotal > 0 && !activeSession.id.includes('-')) {
      await updateDoc(sessionDoc(activeSession.id), {
        cash_collected: increment(syncedCashTotal),
        expected_cash:  increment(syncedCashTotal),
      }).catch((err) =>
        logError('syncService:sessionCash', err,
          `Failed to update cash_collected on session ${activeSession.id}`),
      );
    }
  } finally {
    syncInProgress = false;
  }

  return { synced, failed, deadLettered };
}

// Promotes a draft session to a real Firestore session, then patches all queued
// orders so their session_id points to the real document. Returns the real session.
export async function reconcileDraftSession(
  draft: CashSession,
  user:  AuthUser,
): Promise<CashSession> {
  const real = await openSession(draft.user_id, draft.cashier_name, draft.starting_cash, draft.start_time);
  await patchPendingOrdersSessionId(draft.id, real.id);
  // openSession already saves to sessionCache (isDraft=false) non-blocking,
  // but do it explicitly here to ensure it completes before we return.
  await saveSessionCache(real, user.uid, false);
  return real;
}

// Applies a session close that was saved offline. No-op if none is queued.
export async function syncPendingClose(): Promise<void> {
  const pending = await loadPendingClose();
  if (!pending) return;
  try {
    await updateDoc(sessionDoc(pending.sessionId), {
      end_time:      pending.closedAt,
      actual_cash:   pending.actualCash,
      expected_cash: pending.expectedCash,
      difference:    pending.actualCash - pending.expectedCash,
      status:        'closed',
    });
    await clearPendingClose();
  } catch (err) {
    logError('syncService:syncPendingClose', err,
      `Failed to sync offline-close for session ${pending.sessionId}`);
  }
}

export async function syncSingleOrder(
  local_id: string,
  session:  CashSession,
  user:     AuthUser,
): Promise<{ success: boolean }> {
  const item = await getPendingOrderById(local_id);
  if (!item) return { success: false };
  if (item.retry_count >= MAX_RETRIES) {
    await saveFailedOrder(item);
    await removePendingOrder(local_id);
    return { success: false };
  }
  if (syncInProgress) {
    console.log('[syncService] Sync in progress — single order retry will wait');
    // Wait for the ongoing sync to finish, then check if this order was already synced
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (!syncInProgress) { clearInterval(interval); resolve(); }
      }, 300);
    });
    const stillPending = await getPendingOrderById(local_id);
    if (!stillPending) return { success: true }; // already synced by the bulk run
  }

  try {
    const effectiveSession: CashSession = item.payload.session_id
      ? { ...session, id: item.payload.session_id }
      : session;
    await createOrder(item.payload, effectiveSession, user, local_id);
    await removePendingOrder(local_id);
    return { success: true };
  } catch (err) {
    await logError('syncService:syncSingleOrder', err, `Failed to sync order ${local_id}`);
    await incrementRetry(local_id);
    return { success: false };
  }
}
