import { getDb } from '../schema';
import { FailedOrder, PendingOrder } from '../../types';

export async function saveFailedOrder(order: PendingOrder): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO failed_orders (local_id, payload, created_at, failed_at)
     VALUES (?,?,?,?)`,
    [order.local_id, JSON.stringify(order.payload), order.created_at, new Date().toISOString()],
  );
}

export async function getFailedOrders(): Promise<FailedOrder[]> {
  const db   = await getDb();
  const rows = await db.getAllAsync<{
    local_id: string; payload: string; created_at: string; failed_at: string;
  }>('SELECT * FROM failed_orders ORDER BY created_at ASC');
  return rows.map((r) => ({
    local_id:   r.local_id,
    payload:    JSON.parse(r.payload),
    created_at: r.created_at,
    failed_at:  r.failed_at,
  }));
}

export async function removeFailedOrder(local_id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM failed_orders WHERE local_id = ?', [local_id]);
}

export async function failedCount(): Promise<number> {
  const db  = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM failed_orders',
  );
  return row?.count ?? 0;
}
