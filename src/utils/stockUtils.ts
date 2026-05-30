import { CartItem } from '../types';

export function buildStockDeductions(
  cartItems: CartItem[],
): { id: string; qty: number }[] {
  const map = new Map<string, number>();

  for (const item of cartItems) {
    if (item.tracking_mode === 'direct' && item.stock_item_id) {
      map.set(item.stock_item_id, (map.get(item.stock_item_id) ?? 0) + item.quantity);
    } else if (item.tracking_mode === 'recipe' && item.recipe_lines?.length) {
      for (const line of item.recipe_lines) {
        if (line.stock_item_id && line.quantity_required > 0) {
          const total = line.quantity_required * item.quantity;
          map.set(line.stock_item_id, (map.get(line.stock_item_id) ?? 0) + total);
        }
      }
    }
    for (const mod of item.modifiers) {
      for (const line of mod.recipe_lines ?? []) {
        if (line.stock_item_id && line.quantity_required > 0) {
          const total = line.quantity_required * item.quantity;
          map.set(line.stock_item_id, (map.get(line.stock_item_id) ?? 0) + total);
        }
      }
    }
  }

  return Array.from(map.entries()).map(([id, qty]) => ({ id, qty }));
}
