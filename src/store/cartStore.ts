import { create } from 'zustand';
import { CartItem, RecipeLine, SelectedModifier } from '../types';

function buildCartKey(productId: string, modifierIds: string[]): string {
  const sorted = [...modifierIds].sort().join(',');
  return `${productId}:${sorted}`;
}

interface CartState {
  items: Record<string, CartItem>;
  total: number;

  addItem: (
    productId:    string,
    name:         string,
    basePrice:    number,
    cost:         number,
    modifiers:    SelectedModifier[],
    notes?:       string,
    trackingMode?: import('../types').TrackingMode,
    stockItemId?:  string | null,
    recipeLines?:  RecipeLine[],
  ) => void;
  updateQuantity: (cartKey: string, quantity: number) => void;
  updateNote: (cartKey: string, note: string) => void;
  clearCart: () => void;

  // Derived helpers
  itemCount: () => number;
  totalQuantity: () => number;
}

function calcTotal(items: Record<string, CartItem>): number {
  return Object.values(items).reduce(
    (sum, item) => sum + item.unit_price * item.quantity,
    0,
  );
}

export const useCartStore = create<CartState>((set, get) => ({
  items: {},
  total: 0,

  addItem: (productId, name, basePrice, cost, modifiers, notes = '', trackingMode, stockItemId, recipeLines) => {
    const modifierIds = modifiers.map((m) => m.modifier_id);
    const cartKey = buildCartKey(productId, modifierIds);
    const modifierTotal = modifiers.reduce((s, m) => s + m.price_delta, 0);
    const unitPrice = basePrice + modifierTotal;

    set((state) => {
      const existing = state.items[cartKey];
      const updated: Record<string, CartItem> = {
        ...state.items,
        [cartKey]: existing
          ? { ...existing, quantity: existing.quantity + 1 }
          : {
              cart_key:      cartKey,
              product_id:    productId,
              name,
              base_price:    basePrice,
              unit_cost:     cost,
              modifier_total: modifierTotal,
              unit_price:    unitPrice,
              modifiers,
              quantity:      1,
              notes,
              tracking_mode: trackingMode,
              stock_item_id: stockItemId,
              recipe_lines:  recipeLines,
            },
      };
      return { items: updated, total: calcTotal(updated) };
    });
  },

  updateQuantity: (cartKey, quantity) => {
    set((state) => {
      if (quantity <= 0) {
        const { [cartKey]: _, ...rest } = state.items;
        return { items: rest, total: calcTotal(rest) };
      }
      const updated = {
        ...state.items,
        [cartKey]: { ...state.items[cartKey], quantity },
      };
      return { items: updated, total: calcTotal(updated) };
    });
  },

  updateNote: (cartKey, note) => {
    set((state) => ({
      items: {
        ...state.items,
        [cartKey]: { ...state.items[cartKey], notes: note },
      },
    }));
  },

  clearCart: () => set({ items: {}, total: 0 }),

  itemCount: () => Object.keys(get().items).length,
  totalQuantity: () =>
    Object.values(get().items).reduce((s, i) => s + i.quantity, 0),
}));
