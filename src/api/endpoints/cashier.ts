import client from '../client';
import { CartItem, CheckoutPayload } from '../../types';

const CTRL = '/controllers/cashierController.php';

async function post<T>(action: string, extra?: Record<string, string>) {
  const params = new URLSearchParams();
  params.append('action', action);
  if (extra) {
    Object.entries(extra).forEach(([k, v]) => params.append(k, v));
  }
  const { data } = await client.post<T>(CTRL, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return data;
}

export async function getCart(): Promise<{
  cart: Record<string, CartItem>;
  total: number;
  item_count: number;
}> {
  return post('getCart');
}

export async function addToCart(productId: number, modifierIds: number[]): Promise<void> {
  const data = await post<{ status: string; message?: string }>('addToCart', {
    id: String(productId),
    modifiers: JSON.stringify(modifierIds),
  });
  if (data.status !== 'success') throw new Error(data.message ?? 'Failed to add item');
}

export async function updateCart(cartKey: string, quantity: number): Promise<void> {
  await post('updateCart', { cart_key: cartKey, quantity: String(quantity) });
}

export async function updateCartNote(cartKey: string, note: string): Promise<void> {
  await post('updateCartNote', { cart_key: cartKey, note });
}

export async function clearCart(): Promise<void> {
  await post('clearCart');
}

export async function verifyManagerCode(
  username: string,
  password: string,
): Promise<string> {
  const data = await post<{ status: string; message?: string; nonce?: string }>(
    'verifyManagerCode',
    { username, password },
  );
  if (data.status !== 'success') throw new Error(data.message ?? 'Invalid credentials');
  return data.nonce ?? '';
}

export async function verifyCashierSwitch(
  username: string,
  password: string,
): Promise<{ user_id: number; user_role: string; full_name: string; username: string }> {
  const data = await post<{
    status: string;
    message?: string;
    user_id: number;
    user_role: string;
    full_name: string;
    username: string;
  }>('verifyCashierSwitch', { username, password });
  if (data.status !== 'success') throw new Error(data.message ?? 'Switch failed');
  return data;
}

export async function checkout(payload: CheckoutPayload): Promise<{
  order_id: number;
  total: number;
  change: number;
  has_kitchen_items: boolean;
  print_warnings: string[];
}> {
  const params = new URLSearchParams();
  params.append('action', 'checkout');
  params.append('payment_method', payload.payment_method);
  params.append('order_type', payload.order_type);
  if (payload.table_number) params.append('table_number', payload.table_number);
  if (payload.discount_amount) params.append('discount_amount', String(payload.discount_amount));
  if (payload.discount_auth_nonce) params.append('discount_auth_nonce', payload.discount_auth_nonce);
  if (payload.cash_received != null) params.append('cash_received', String(payload.cash_received));
  if (payload.reference_number) params.append('reference_number', payload.reference_number);

  const { data } = await client.post<{
    status: string;
    message?: string;
    order_id: number;
    total: number;
    change: number;
    has_kitchen_items: boolean;
    print_warnings: string[];
  }>(CTRL, params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  if (data.status !== 'success') throw new Error(data.message ?? 'Checkout failed');
  return data;
}
