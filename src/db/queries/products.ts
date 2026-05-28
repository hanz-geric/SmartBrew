import { getDb } from '../schema';
import { Product } from '../../types';

export async function saveProducts(products: Product[]): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM products');
    for (const p of products) {
      await db.runAsync(
        `INSERT INTO products
          (id, name, price, cost, category_id, category_name, tracking_mode,
           stock_item_id, image, needs_kitchen, is_active, stock_status,
           modifier_groups, recipe_lines, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id, p.name, p.price, p.cost, p.category_id, p.category_name,
          p.tracking_mode, p.stock_item_id ?? null, p.image ?? null,
          p.needs_kitchen ? 1 : 0, p.is_active ? 1 : 0, p.stock_status,
          JSON.stringify(p.modifier_groups), JSON.stringify(p.recipe_lines ?? []), now,
        ],
      );
    }
  });
}

export async function loadCachedProducts(): Promise<Product[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM products WHERE is_active = 1');

  return rows.map((r) => ({
    id:              r.id as string,
    name:            r.name as string,
    price:           r.price as number,
    cost:            r.cost as number,
    category_id:     r.category_id as string,
    category_name:   r.category_name as string,
    tracking_mode:   r.tracking_mode as Product['tracking_mode'],
    stock_item_id:   r.stock_item_id as string | null,
    image:           r.image as string | null,
    needs_kitchen:   (r.needs_kitchen as number) === 1,
    is_active:       (r.is_active as number) === 1,
    stock_status:    r.stock_status as Product['stock_status'],
    modifier_groups: JSON.parse(r.modifier_groups as string),
    recipe_lines:    JSON.parse((r.recipe_lines as string) ?? '[]'),
  }));
}

export async function hasCachedProducts(): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM products');
  return (row?.count ?? 0) > 0;
}
