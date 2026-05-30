import { getDb } from '../schema';
import { StockItem } from '../../types';

export async function initStockCache(items: StockItem[]): Promise<void> {
  const db  = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const item of items) {
      await db.runAsync(
        `REPLACE INTO stock_cache (id, quantity_on_hand, reorder_level, updated_at)
         VALUES (?,?,?,?)`,
        [item.id, item.quantity_on_hand, item.reorder_level, now],
      );
    }
  });
}

export async function deductStock(
  deductions: { id: string; qty: number }[],
): Promise<void> {
  if (!deductions.length) return;
  const db  = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const d of deductions) {
      // Use MAX(0, ...) so quantity never goes below zero in the local ledger
      await db.runAsync(
        `UPDATE stock_cache
         SET quantity_on_hand = MAX(0, quantity_on_hand - ?), updated_at = ?
         WHERE id = ?`,
        [d.qty, now, d.id],
      );
    }
  });
}

export async function replaceStockCache(items: StockItem[]): Promise<void> {
  const db  = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM stock_cache');
    for (const item of items) {
      await db.runAsync(
        `INSERT INTO stock_cache (id, quantity_on_hand, reorder_level, updated_at)
         VALUES (?,?,?,?)`,
        [item.id, item.quantity_on_hand, item.reorder_level, now],
      );
    }
  });
}
