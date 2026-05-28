import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import { getDb } from '../schema';
import { PendingOrder, CheckoutPayload } from '../../types';

export async function enqueueOrder(payload: CheckoutPayload): Promise<string> {
  const db = await getDb();
  const local_id = uuid();
  const now = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO pending_orders (local_id, payload, created_at, retry_count) VALUES (?, ?, ?, 0)',
    [local_id, JSON.stringify(payload), now],
  );
  return local_id;
}

export async function getPendingOrders(): Promise<PendingOrder[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    local_id: string;
    payload: string;
    created_at: string;
    retry_count: number;
  }>('SELECT * FROM pending_orders ORDER BY created_at ASC');

  return rows.map((r) => ({
    local_id:    r.local_id,
    payload:     JSON.parse(r.payload),
    created_at:  r.created_at,
    retry_count: r.retry_count,
  }));
}

export async function removePendingOrder(local_id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM pending_orders WHERE local_id = ?', [local_id]);
}

export async function incrementRetry(local_id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE pending_orders SET retry_count = retry_count + 1 WHERE local_id = ?',
    [local_id],
  );
}

export async function pendingCount(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM pending_orders',
  );
  return row?.count ?? 0;
}
