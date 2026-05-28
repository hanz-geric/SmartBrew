import {
  getPendingOrders, removePendingOrder, incrementRetry,
} from '../db/queries/queue';
import { createOrder } from '../firebase/firestoreService';
import { AuthUser, CashSession } from '../types';

const MAX_RETRIES = 5;

export interface SyncResult {
  synced: number;
  failed: number;
}

export async function syncPendingOrders(
  session: CashSession,
  user:    AuthUser,
): Promise<SyncResult> {
  const pending = await getPendingOrders();
  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    if (item.retry_count >= MAX_RETRIES) {
      // Permanently drop exhausted items so they don't block the queue forever
      await removePendingOrder(item.local_id);
      failed++;
      continue;
    }
    try {
      await createOrder(item.payload, session, user);
      await removePendingOrder(item.local_id);
      synced++;
    } catch {
      await incrementRetry(item.local_id);
      failed++;
    }
  }

  return { synced, failed };
}
