import { getDb } from '../schema';
import { Category, Product, StockItem } from '../../types';

function stockStatus(qty: number, reorder: number): Product['stock_status'] {
  if (qty <= 0) return 'out';
  if (reorder > 0 && qty <= reorder) return 'low';
  return 'ok';
}

export async function writeProductsCache(products: Product[]): Promise<void> {
  const db  = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const p of products) {
      await db.runAsync(
        `REPLACE INTO products
           (id, name, price, cost, category_id, category_name, tracking_mode,
            stock_item_id, image, needs_kitchen, is_active, stock_status,
            modifier_groups, recipe_lines, category_ids, synced_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          p.id, p.name, p.price, p.cost,
          p.category_id, p.category_name, p.tracking_mode,
          p.stock_item_id ?? null, p.image ?? null,
          p.needs_kitchen ? 1 : 0, p.is_active ? 1 : 0,
          p.stock_status,
          JSON.stringify(p.modifier_groups ?? []),
          JSON.stringify(p.recipe_lines ?? []),
          JSON.stringify(p.category_ids ?? []),
          now,
        ],
      );
    }
  });
}

export async function writeCategoriesCache(categories: Category[]): Promise<void> {
  const db  = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const c of categories) {
      await db.runAsync(
        `REPLACE INTO categories (id, name, sort_order, is_active, synced_at)
         VALUES (?,?,?,?,?)`,
        [c.id, c.name, c.sort_order, c.is_active ? 1 : 0, now],
      );
    }
  });
}

export async function getCachedProducts(): Promise<Product[]> {
  const db = await getDb();

  // Build live stock map from local ledger for accurate stock_status
  const stockRows = await db.getAllAsync<{
    id: string; quantity_on_hand: number; reorder_level: number;
  }>('SELECT id, quantity_on_hand, reorder_level FROM stock_cache');
  const stockMap = new Map(stockRows.map((r) => [r.id, r]));

  const rows = await db.getAllAsync<{
    id: string; name: string; price: number; cost: number;
    category_id: string; category_name: string; tracking_mode: string;
    stock_item_id: string | null; image: string | null;
    needs_kitchen: number; is_active: number; stock_status: string;
    modifier_groups: string; recipe_lines: string; category_ids: string;
  }>('SELECT * FROM products WHERE is_active = 1');

  return rows.map((r) => {
    // Recompute stock_status from live ledger if applicable
    let live_status = r.stock_status as Product['stock_status'];
    if (r.tracking_mode === 'direct' && r.stock_item_id) {
      const s = stockMap.get(r.stock_item_id);
      if (s) live_status = stockStatus(s.quantity_on_hand, s.reorder_level);
    }

    return {
      id:              r.id,
      name:            r.name,
      price:           r.price,
      cost:            r.cost,
      category_id:     r.category_id,
      category_name:   r.category_name,
      tracking_mode:   r.tracking_mode as Product['tracking_mode'],
      stock_item_id:   r.stock_item_id,
      image:           r.image,
      needs_kitchen:   r.needs_kitchen === 1,
      is_active:       r.is_active === 1,
      stock_status:    live_status,
      modifier_groups: JSON.parse(r.modifier_groups),
      recipe_lines:    JSON.parse(r.recipe_lines),
      category_ids:    JSON.parse(r.category_ids ?? '[]'),
    };
  });
}

export async function getCachedCategories(): Promise<Category[]> {
  const db   = await getDb();
  const rows = await db.getAllAsync<{
    id: string; name: string; sort_order: number; is_active: number;
  }>('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC');
  return rows.map((r) => ({
    id:         r.id,
    name:       r.name,
    sort_order: r.sort_order,
    is_active:  r.is_active === 1,
  }));
}

// Returns ms since last cache write, or null if cache is empty
export async function getCatalogAge(): Promise<number | null> {
  const db  = await getDb();
  const row = await db.getFirstAsync<{ synced_at: string }>(
    'SELECT synced_at FROM products ORDER BY synced_at ASC LIMIT 1',
  );
  if (!row) return null;
  return Date.now() - new Date(row.synced_at).getTime();
}
