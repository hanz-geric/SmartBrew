import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDb } from '../schema';
import { Category, Product } from '../../types';

const PRODUCTS_KEY   = '@smartbrew:products_cache';
const CATEGORIES_KEY = '@smartbrew:categories_cache';
const SYNCED_AT_KEY  = '@smartbrew:catalog_synced_at';

function stockStatus(qty: number, reorder: number): Product['stock_status'] {
  if (qty <= 0) return 'out';
  if (reorder > 0 && qty <= reorder) return 'low';
  return 'ok';
}

export async function writeProductsCache(products: Product[]): Promise<void> {
  await AsyncStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
  await AsyncStorage.setItem(SYNCED_AT_KEY, new Date().toISOString());
}

export async function writeCategoriesCache(categories: Category[]): Promise<void> {
  await AsyncStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
}

export async function getCachedProducts(): Promise<Product[]> {
  const raw = await AsyncStorage.getItem(PRODUCTS_KEY);
  if (!raw) return [];
  const products: Product[] = JSON.parse(raw);

  // Overlay live stock_status from the SQLite ledger (optimistic deductions).
  // If the ledger isn't available we fall back to the cached status.
  try {
    const db = await getDb();
    const stockRows = await db.getAllAsync<{
      id: string; quantity_on_hand: number; reorder_level: number;
    }>('SELECT id, quantity_on_hand, reorder_level FROM stock_cache');
    const stockMap = new Map(stockRows.map((r) => [r.id, r]));

    return products
      .filter((p) => p.is_active)
      .map((p) => {
        if (p.tracking_mode === 'direct' && p.stock_item_id) {
          const s = stockMap.get(p.stock_item_id);
          if (s) return { ...p, stock_status: stockStatus(s.quantity_on_hand, s.reorder_level) };
        }
        return p;
      });
  } catch {
    return products.filter((p) => p.is_active);
  }
}

export async function getCachedCategories(): Promise<Category[]> {
  const raw = await AsyncStorage.getItem(CATEGORIES_KEY);
  if (!raw) return [];
  return JSON.parse(raw);
}

// Returns ms since last cache write, or null if cache is empty
export async function getCatalogAge(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(SYNCED_AT_KEY);
  if (!raw) return null;
  return Date.now() - new Date(raw).getTime();
}
