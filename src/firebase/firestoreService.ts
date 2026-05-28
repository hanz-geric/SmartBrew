import {
  query, where, orderBy, limit, getDocs, addDoc,
  updateDoc, getDoc, setDoc, DocumentData, increment,
  getAggregateFromServer, getCountFromServer, sum, count,
  writeBatch, doc,
} from 'firebase/firestore';
import { db } from './config';
import {
  usersCol, sessionsCol, productsCol, categoriesCol, ordersCol, modGroupsCol, stockCol,
  userDoc, sessionDoc, orderDoc, settingsDoc, productDoc, categoryDoc, modGroupDoc, stockDoc,
} from './collections';
import {
  AuthUser, CartItem, CashSession, Category, CheckoutPayload,
  ModifierGroup, Order, OrderItem, Product, Settings, StockItem, StockStatus,
  UserProfile, UserRole,
} from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSession(id: string, d: DocumentData): CashSession {
  return {
    id,
    user_id:        d.user_id,
    cashier_name:   d.cashier_name,
    start_time:     d.start_time,
    end_time:       d.end_time   ?? null,
    starting_cash:  d.starting_cash,
    expected_cash:  d.expected_cash ?? null,
    actual_cash:    d.actual_cash   ?? null,
    difference:     d.difference    ?? null,
    status:         d.status,
    cash_collected: d.cash_collected ?? 0,
  };
}

// ─── Cash Sessions ────────────────────────────────────────────────────────────

export async function getSession(sessionId: string): Promise<CashSession | null> {
  const snap = await getDoc(sessionDoc(sessionId));
  if (!snap.exists()) return null;
  return toSession(snap.id, snap.data());
}

export async function getOpenSession(userId: string): Promise<CashSession | null> {
  const q = query(
    sessionsCol(),
    where('user_id', '==', userId),
    where('status',  '==', 'open'),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return toSession(d.id, d.data());
}

export async function openSession(
  userId:       string,
  cashierName:  string,
  startingCash: number,
): Promise<CashSession> {
  const now  = new Date().toISOString();
  const data = {
    user_id:        userId,
    cashier_name:   cashierName,
    start_time:     now,
    end_time:       null,
    starting_cash:  startingCash,
    expected_cash:  null,
    actual_cash:    null,
    difference:     null,
    status:         'open',
    cash_collected: 0,
  };
  const ref = await addDoc(sessionsCol(), data);
  return { id: ref.id, ...data } as CashSession;
}

export async function closeSession(
  sessionId:    string,
  actualCash:   number,
  expectedCash: number,
): Promise<void> {
  await updateDoc(sessionDoc(sessionId), {
    end_time:      new Date().toISOString(),
    actual_cash:   actualCash,
    expected_cash: expectedCash,
    difference:    actualCash - expectedCash,
    status:        'closed',
  });
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export async function createOrder(
  payload:  CheckoutPayload,
  session:  CashSession,
  user:     AuthUser,
): Promise<Order> {
  const now        = new Date();
  const nowISO     = now.toISOString();
  const dateStr    = nowISO.slice(0, 10).replace(/-/g, '');
  const seq        = String(now.getTime()).slice(-5);
  const orderNumber = `${dateStr}-${seq}`;

  const subtotal       = payload.cart_snapshot.reduce(
    (s, item) => s + item.unit_price * item.quantity, 0,
  );
  const discountAmount = payload.discount_amount ?? 0;
  const totalAmount    = subtotal - discountAmount;
  const profitAmount   = payload.cart_snapshot.reduce(
    (s, item) => s + (item.unit_price - item.unit_cost) * item.quantity, 0,
  );

  const items: OrderItem[] = payload.cart_snapshot.map((item: CartItem) => ({
    product_id:   item.product_id,
    product_name: item.name,
    unit_price:   item.unit_price,
    unit_cost:    item.unit_cost,
    quantity:     item.quantity,
    subtotal:     item.unit_price * item.quantity,
    notes:        item.notes || null,
    modifiers:    item.modifiers,
  }));

  const orderData = {
    order_number:    orderNumber,
    user_id:         user.uid,
    cashier_name:    user.full_name || user.username,
    subtotal,
    discount_amount: discountAmount,
    total_amount:    totalAmount,
    profit_amount:   profitAmount,
    payment_method:  payload.payment_method,
    payment_status:  'paid'      as const,
    status:          'completed' as const,
    order_type:      payload.order_type,
    table_number:    payload.table_number ?? null,
    session_id:      session.id,
    created_at:      nowISO,
    completed_at:    nowISO,
    items,
  };

  const batch  = writeBatch(db);
  const newRef = doc(ordersCol());
  batch.set(newRef, orderData);

  // Track cash collected on the session
  if (payload.payment_method === 'cash') {
    const newCollected = (session.cash_collected ?? 0) + totalAmount;
    batch.update(sessionDoc(session.id), {
      cash_collected: newCollected,
      expected_cash:  session.starting_cash + newCollected,
    });
  }

  // Deduct stock for direct-tracked and recipe-tracked items
  for (const item of payload.cart_snapshot) {
    if (item.tracking_mode === 'direct' && item.stock_item_id) {
      batch.update(stockDoc(item.stock_item_id), {
        quantity_on_hand: increment(-item.quantity),
      });
    } else if (item.tracking_mode === 'recipe' && item.recipe_lines?.length) {
      for (const line of item.recipe_lines) {
        if (line.stock_item_id && line.quantity_required > 0) {
          batch.update(stockDoc(line.stock_item_id), {
            quantity_on_hand: increment(-(line.quantity_required * item.quantity)),
          });
        }
      }
    }
  }

  await batch.commit();
  return { id: newRef.id, ...orderData };
}

export async function voidOrder(orderId: string): Promise<void> {
  await updateDoc(orderDoc(orderId), {
    status:         'cancelled',
    payment_status: 'unpaid',
  });
}

export async function getOrdersBySession(sessionId: string): Promise<Order[]> {
  const q    = query(ordersCol(), where('session_id', '==', sessionId));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Order, 'id'>) }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function getOrder(orderId: string): Promise<Order | null> {
  const snap = await getDoc(orderDoc(orderId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<Order, 'id'>) };
}

// Admin: date-range query — orderBy same field as inequality, no composite index needed
export async function getOrdersInRange(
  startISO: string,
  endISO:   string,
): Promise<Order[]> {
  const q = query(
    ordersCol(),
    where('created_at', '>=', startISO),
    where('created_at', '<=', endISO),
    orderBy('created_at', 'desc'),
    limit(500),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Order, 'id'>) }));
}

// Admin: recent sessions (all cashiers), newest first
export async function getRecentSessions(limitCount = 30): Promise<CashSession[]> {
  const q = query(
    sessionsCol(),
    orderBy('start_time', 'desc'),
    limit(limitCount),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toSession(d.id, d.data()));
}

// Admin: sessions within a date range
export async function getSessionsInRange(startISO: string, endISO: string): Promise<CashSession[]> {
  const q = query(
    sessionsCol(),
    where('start_time', '>=', startISO),
    where('start_time', '<=', endISO),
    orderBy('start_time', 'desc'),
    limit(200),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => toSession(d.id, d.data()));
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  const snap = await getDoc(settingsDoc());
  if (!snap.exists()) return {};
  return snap.data() as Settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await setDoc(settingsDoc(), settings, { merge: true });
}

// ─── Products & Categories (POS — active only) ────────────────────────────────

export async function getProducts(): Promise<Product[]> {
  const q    = query(productsCol(), where('is_active', '==', true));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id:              d.id,
    ...(d.data()  as Omit<Product, 'id'>),
    stock_status:    (d.data().stock_status    as Product['stock_status'])   ?? 'ok',
    modifier_groups: (d.data().modifier_groups as Product['modifier_groups']) ?? [],
    recipe_lines:    (d.data().recipe_lines    as Product['recipe_lines'])   ?? [],
  }));
}

export async function getCategories(): Promise<Category[]> {
  const q    = query(categoriesCol(), where('is_active', '==', true));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Category, 'id'>) }))
    .sort((a, b) => a.sort_order - b.sort_order);
}

// ─── Products & Categories (Admin — all records) ──────────────────────────────

export async function getAllProducts(): Promise<Product[]> {
  const snap = await getDocs(productsCol());
  return snap.docs
    .map((d) => ({
      id:              d.id,
      ...(d.data()  as Omit<Product, 'id'>),
      stock_status:    (d.data().stock_status    as Product['stock_status'])   ?? 'ok',
      modifier_groups: (d.data().modifier_groups as Product['modifier_groups']) ?? [],
      recipe_lines:    (d.data().recipe_lines    as Product['recipe_lines'])   ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAllCategories(): Promise<Category[]> {
  const snap = await getDocs(categoriesCol());
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Category, 'id'>) }))
    .sort((a, b) => a.sort_order - b.sort_order);
}

export async function getAllModifierGroups(): Promise<ModifierGroup[]> {
  const snap = await getDocs(modGroupsCol());
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<ModifierGroup, 'id'>) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertProduct(
  data: Omit<Product, 'id' | 'stock_status'>,
  id?: string,
): Promise<string> {
  if (id) {
    await setDoc(productDoc(id), data, { merge: true });
    return id;
  }
  const ref = await addDoc(productsCol(), data);
  return ref.id;
}

export async function upsertCategory(
  data: Omit<Category, 'id'>,
  id?: string,
): Promise<string> {
  if (id) {
    await setDoc(categoryDoc(id), data, { merge: true });
    return id;
  }
  const ref = await addDoc(categoriesCol(), data);
  return ref.id;
}

export async function upsertModifierGroup(
  data: Omit<ModifierGroup, 'id'>,
  id?: string,
): Promise<string> {
  if (id) {
    await setDoc(modGroupDoc(id), data);
    return id;
  }
  const ref = await addDoc(modGroupsCol(), data);
  return ref.id;
}

export async function deleteModifierGroup(id: string): Promise<void> {
  const { deleteDoc } = await import('firebase/firestore');
  await deleteDoc(modGroupDoc(id));
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function listUsers(): Promise<UserProfile[]> {
  const snap = await getDocs(usersCol());
  return snap.docs
    .map((d) => {
      const data = d.data() as DocumentData;
      return {
        uid:       d.id,
        username:  (data.username  as string)  ?? '',
        full_name: (data.full_name as string)  ?? '',
        role:      (data.role      as UserRole) ?? 'cashier',
        is_active: data.is_active !== false,
      } as UserProfile;
    })
    .sort((a, b) => a.username.localeCompare(b.username));
}

export async function updateUserProfile(
  uid:  string,
  data: Partial<Omit<UserProfile, 'uid'>>,
): Promise<void> {
  await updateDoc(userDoc(uid), data);
}

// ─── Stock Items ──────────────────────────────────────────────────────────────

function stockStatus(qty: number, reorder: number): StockStatus {
  if (qty <= 0) return 'out';
  if (reorder > 0 && qty <= reorder) return 'low';
  return 'ok';
}

export async function listStockItems(): Promise<StockItem[]> {
  const snap = await getDocs(stockCol());
  return snap.docs
    .map((d) => {
      const data    = d.data() as DocumentData;
      const qty     = (data.quantity_on_hand as number) ?? 0;
      const reorder = (data.reorder_level    as number) ?? 0;
      return {
        id:               d.id,
        name:             (data.name          as string)  ?? '',
        unit:             (data.unit          as string)  ?? '',
        quantity_on_hand: qty,
        reorder_level:    reorder,
        cost_per_unit:    (data.cost_per_unit as number)  ?? 0,
        is_active:        data.is_active !== false,
        stock_status:     stockStatus(qty, reorder),
      } as StockItem;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function upsertStockItem(
  data: Omit<StockItem, 'id' | 'stock_status'>,
  id?: string,
): Promise<string> {
  if (id) {
    await setDoc(stockDoc(id), data, { merge: true });
    return id;
  }
  const ref = await addDoc(stockCol(), data);
  return ref.id;
}

export async function adjustStockItem(id: string, delta: number): Promise<void> {
  await updateDoc(stockDoc(id), { quantity_on_hand: increment(delta) });
}

export async function deleteStockItem(id: string): Promise<void> {
  const { deleteDoc } = await import('firebase/firestore');
  await deleteDoc(stockDoc(id));
}

// ─── Lifetime Stats (Dashboard) ───────────────────────────────────────────────

export interface LifetimeStats {
  total_revenue:  number;
  total_profit:   number;
  total_orders:   number;
  by_status:      { status: string; count: number }[];
}

export async function getLifetimeStats(): Promise<LifetimeStats> {
  const completedQ  = query(ordersCol(), where('status', '==', 'completed'));
  const allQ        = ordersCol();

  const [agg, allSnap] = await Promise.all([
    getAggregateFromServer(completedQ, {
      total_revenue: sum('total_amount'),
      total_profit:  sum('profit_amount'),
      total_orders:  count(),
    }),
    getDocs(query(ordersCol())),
  ]);

  const statusMap: Record<string, number> = {};
  allSnap.forEach((d) => {
    const s = d.data().status as string;
    statusMap[s] = (statusMap[s] ?? 0) + 1;
  });

  return {
    total_revenue: agg.data().total_revenue ?? 0,
    total_profit:  agg.data().total_profit  ?? 0,
    total_orders:  agg.data().total_orders  ?? 0,
    by_status:     Object.entries(statusMap).map(([status, c]) => ({ status, count: c })),
  };
}

export async function getProductCategoryCount(): Promise<{ product_count: number; category_count: number }> {
  const [prods, cats] = await Promise.all([
    getCountFromServer(query(productsCol(),   where('is_active', '==', true))),
    getCountFromServer(query(categoriesCol(), where('is_active', '==', true))),
  ]);
  return {
    product_count:  prods.data().count,
    category_count: cats.data().count,
  };
}
