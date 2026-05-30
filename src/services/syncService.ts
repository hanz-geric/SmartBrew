import {
  getPendingOrders, getPendingOrderById, removePendingOrder,
  incrementRetry, patchPendingOrdersSessionId,
} from '../db/queries/queue';
import { saveFailedOrder } from '../db/queries/failedOrders';
import { createOrder, openSession } from '../firebase/firestoreService';
import { saveSessionCache } from '../db/queries/sessionCache';
import { AuthUser, CashSession } from '../types';

const MAX_RETRIES = 5;

export interface SyncResult {
  synced:      number;
  failed:      number;
  deadLettered: number;
}

export async function syncPendingOrders(
  session: CashSession,
  user:    AuthUser,
): Promise<SyncResult> {
  const pending = await getPendingOrders();
  let synced      = 0;
  let failed      = 0;
  let deadLettered = 0;

  for (const item of pending) {
    if (item.retry_count >= MAX_RETRIES) {
      // Move to dead-letter table so cashier can see what was lost
      await saveFailedOrder(item);
      await removePendingOrder(item.local_id);
      deadLettered++;
      continue;
    }
    try {
      const effectiveSession: CashSession = item.payload.session_id
        ? { ...session, id: item.payload.session_id }
        : session;
      await createOrder(item.payload, effectiveSession, user);
      await removePendingOrder(item.local_id);
      synced++;
    } catch {
      await incrementRetry(item.local_id);
      failed++;
    }
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
  try {
    const effectiveSession: CashSession = item.payload.session_id
      ? { ...session, id: item.payload.session_id }
      : session;
    await createOrder(item.payload, effectiveSession, user);
    await removePendingOrder(local_id);
    return { success: true };
  } catch {
    await incrementRetry(local_id);
    return { success: false };
  }
}
