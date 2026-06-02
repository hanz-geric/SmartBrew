import {
  query, where, orderBy, limit, getDocs, addDoc,
  updateDoc, getDoc, setDoc, DocumentData, increment,
  getAggregateFromServer, getCountFromServer, sum, count,
  writeBatch, doc, arrayUnion,
} from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { db, auth } from './config';
import { ensureAuthenticated } from './authRestore';
import {
  usersCol, sessionsCol, productsCol, categoriesCol, ordersCol, modGroupsCol, stockCol,
  userDoc, sessionDoc, orderDoc, settingsDoc, productDoc, categoryDoc, modGroupDoc, stockDoc,
} from './collections';
import {
  AuthUser, CartItem, CashierEvent, CashSession, Category, CheckoutPayload,
  ModifierGroup, Order, OrderItem, Product, RosterEntry, Settings, StockItem,
  StockStatus, UserProfile, UserRole,
} from '../types';
import { writeProductsCache, writeCategoriesCache, getCachedProducts, getCachedCategories } from '../db/queries/catalog';
import { replaceStockCache } from '../db/queries/stockCache';
import { clearSessionCache, saveSessionCache } from '../db/queries/sessionCache';
import { logError } from '../utils/logger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toSession(id: string, d: DocumentData): CashSession {
  return {
    id,
    user_id:              d.user_id,
    cashier_name:         d.cashier_name,
    start_time:           d.start_time,
    end_time:             d.end_time        ?? null,
    starting_cash:        d.starting_cash,
    expected_cash:        d.expected_cash   ?? null,
    actual_cash:          d.actual_cash     ?? null,
    difference:           d.difference      ?? null,
    status:               d.status,
    cash_collected:       d.cash_collected  ?? 0,
    opened_by_uid:        d.opened_by_uid   ?? undefined,
    opened_by_name:       d.opened_by_name  ?? undefined,
    closed_by_uid:        d.closed_by_uid   ?? undefined,
    closed_by_name:       d.closed_by_name  ?? undefined,
    active_cashier_uid:   d.active_cashier_uid  ?? undefined,
    active_cashier_name:  d.active_cashier_name ?? undefined,
    roster:               (d.roster      as RosterEntry[])  ?? [],
    cashier_log:          (d.cashier_log as CashierEvent[]) ?? [],
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

// Register-owned query: finds whichever drawer is open on this register.
// Used instead of getOpenSession so any authenticated cashier can resume/close
// a drawer regardless of who opened it.
export async function getAnyOpenSession(): Promise<CashSession | null> {
  const q = query(
    sessionsCol(),
    where('status', '==', 'open'),
    orderBy('start_time', 'desc'),
    limit(1),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return toSession(snap.docs[0].id, snap.docs[0].data());
}

export async function openSession(
  userId:       string,
  cashierName:  string,
  startingCash: number,
  startTime?:   string,
  userInfo?:    { username: string; role: UserRole },
): Promise<CashSession> {
  const fbUser = await ensureAuthenticated();
  if (fbUser) {
    try {
      await fbUser.getIdToken(true);
    } catch (err) {
      logError('openSession:tokenRefresh', err, `uid=${fbUser.uid} token refresh failed`);
      throw err;
    }
  } else {
    logError('openSession:tokenRefresh', null, 'No signed-in user after waiting for auth restore');
    throw new Error('User not authenticated');
  }

  const now      = startTime ?? new Date().toISOString();
  const role     = userInfo?.role     ?? 'cashier';
  const username = userInfo?.username ?? '';

  const openerEntry: RosterEntry = {
    uid:          userId,
    username,
    full_name:    cashierName,
    role,
    clock_in_at:  now,
    clock_out_at: null,
    status:       'active',
  };
  const openEvent: CashierEvent = {
    uid:       userId,
    username,
    full_name: cashierName,
    role,
    action:    'open',
    at:        now,
  };

  const data = {
    user_id:              userId,
    cashier_name:         cashierName,
    start_time:           now,
    end_time:             null,
    starting_cash:        startingCash,
    expected_cash:        null,
    actual_cash:          null,
    difference:           null,
    status:               'open',
    cash_collected:       0,
    opened_by_uid:        userId,
    opened_by_name:       cashierName,
    closed_by_uid:        null,
    closed_by_name:       null,
    active_cashier_uid:   userId,
    active_cashier_name:  cashierName,
    roster:               [openerEntry],
    cashier_log:          [openEvent],
  };
  const ref     = await addDoc(sessionsCol(), data);
  const session = { id: ref.id, ...data } as CashSession;
  saveSessionCache(session, userId).catch(() => {});
  return session;
}

export async function closeSession(
  sessionId:    string,
  actualCash:   number,
  expectedCash: number,
  userId:       string,
  closerInfo?:  { uid: string; name: string },
): Promise<void> {
  const fbUser = await ensureAuthenticated();
  if (fbUser) {
    try {
      await fbUser.getIdToken(true);
    } catch (err) {
      logError('closeSession:tokenRefresh', err, `uid=${fbUser.uid} token refresh failed`);
      throw err;
    }
  } else {
    logError('closeSession:tokenRefresh', null, 'No signed-in user');
    throw new Error('User not authenticated');
  }
  await updateDoc(sessionDoc(sessionId), {
    end_time:        new Date().toISOString(),
    actual_cash:     actualCash,
    expected_cash:   expectedCash,
    difference:      actualCash - expectedCash,
    status:          'closed',
    ...(closerInfo && {
      closed_by_uid:  closerInfo.uid,
      closed_by_name: closerInfo.name,
    }),
  });
  clearSessionCache(userId).catch(() => {});
}

// ─── Cashier Roster ───────────────────────────────────────────────────────────

// Adds a new cashier to the session roster and makes them the active cashier.
// Emits switch_out for the previous active, clock_in + switch_in for the new one.
export async function addCashierToRoster(
  sessionId:   string,
  newUser:     AuthUser,
  prevUser:    AuthUser,
  currentRoster: RosterEntry[],
): Promise<{ roster: RosterEntry[]; log: CashierEvent[] }> {
  const now = new Date().toISOString();

  const switchOut: CashierEvent = {
    uid: prevUser.uid, username: prevUser.username,
    full_name: prevUser.full_name, role: prevUser.role,
    action: 'switch_out', at: now,
  };
  const clockIn: CashierEvent = {
    uid: newUser.uid, username: newUser.username,
    full_name: newUser.full_name, role: newUser.role,
    action: 'clock_in', at: now,
  };

  const newEntry: RosterEntry = {
    uid: newUser.uid, username: newUser.username,
    full_name: newUser.full_name, role: newUser.role,
    clock_in_at: now, clock_out_at: null, status: 'active',
  };
  const updatedRoster = [...currentRoster, newEntry];

  if (!sessionId.includes('-')) {
    await updateDoc(sessionDoc(sessionId), {
      active_cashier_uid:  newUser.uid,
      active_cashier_name: newUser.full_name,
      roster:              updatedRoster,
      cashier_log:         arrayUnion(switchOut, clockIn),
    });
  }
  return { roster: updatedRoster, log: [switchOut, clockIn] };
}

// Switches the active cashier to an already-rostered cashier (tap-to-switch).
// Emits switch_out for prev, switch_in for next.
export async function switchActiveCashier(
  sessionId:   string,
  prevUser:    AuthUser,
  nextUser:    AuthUser,
): Promise<CashierEvent[]> {
  const now = new Date().toISOString();
  const switchOut: CashierEvent = {
    uid: prevUser.uid, username: prevUser.username,
    full_name: prevUser.full_name, role: prevUser.role,
    action: 'switch_out', at: now,
  };
  const switchIn: CashierEvent = {
    uid: nextUser.uid, username: nextUser.username,
    full_name: nextUser.full_name, role: nextUser.role,
    action: 'switch_in', at: now,
  };

  if (!sessionId.includes('-')) {
    await updateDoc(sessionDoc(sessionId), {
      active_cashier_uid:  nextUser.uid,
      active_cashier_name: nextUser.full_name,
      cashier_log:         arrayUnion(switchOut, switchIn),
    });
  }
  return [switchOut, switchIn];
}

// Clocks out a single cashier from the roster (they leave for the day).
// If they were the active cashier the caller must switch to someone else first.
export async function clockOutCashierEntry(
  sessionId:     string,
  uid:           string,
  currentRoster: RosterEntry[],
): Promise<{ roster: RosterEntry[]; log: CashierEvent[] }> {
  const now = new Date().toISOString();
  const entry = currentRoster.find((e) => e.uid === uid);
  if (!entry) return { roster: currentRoster, log: [] };

  const updated = currentRoster.map((e) =>
    e.uid === uid ? { ...e, clock_out_at: now, status: 'clocked_out' as const } : e,
  );
  const clockOutEvent: CashierEvent = {
    uid: entry.uid, username: entry.username,
    full_name: entry.full_name, role: entry.role,
    action: 'clock_out', at: now,
  };

  if (!sessionId.includes('-')) {
    await updateDoc(sessionDoc(sessionId), {
      roster:      updated,
      cashier_log: arrayUnion(clockOutEvent),
    });
  }
  return { roster: updated, log: [clockOutEvent] };
}

// Clocks out ALL still-active cashiers — called when closing the shift.
export async function clockOutAllActiveCashiers(
  sessionId:     string,
  currentRoster: RosterEntry[],
): Promise<void> {
  const active = currentRoster.filter((e) => e.status === 'active');
  if (active.length === 0) return;

  const now     = new Date().toISOString();
  const updated = currentRoster.map((e) =>
    e.status === 'active' ? { ...e, clock_out_at: now, status: 'clocked_out' as const } : e,
  );
  const events: CashierEvent[] = active.map((e) => ({
    uid: e.uid, username: e.username,
    full_name: e.full_name, role: e.role,
    action: 'clock_out' as const, at: now,
  }));

  if (!sessionId.includes('-')) {
    await updateDoc(sessionDoc(sessionId), {
      roster:      updated,
      cashier_log: arrayUnion(...events),
    }).catch((err) =>
      logError('clockOutAllActiveCashiers', err, `session=${sessionId}`),
    );
  }
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export async function createOrder(
  payload:        CheckoutPayload,
  session:        CashSession,
  user:           AuthUser,
  idempotencyId?: string,   // When provided (offline sync), used as the Firestore doc ID
): Promise<Order> {
  const now        = new Date();
  const nowISO     = now.toISOString();
  const dateStr    = nowISO.slice(0, 10).replace(/-/g, '');
  const seq        = String(now.getTime()).slice(-5);
  // Firestore ID suffix makes the number unique even if two orders land in the same millisecond
  // Use the caller-supplied ID (offline sync) so a double-sync overwrites the
  // same Firestore document instead of creating a duplicate order.
  const newRef     = idempotencyId ? doc(ordersCol(), idempotencyId) : doc(ordersCol());
  const orderNumber = payload.order_number
    ?? `${dateStr}-${seq}-${newRef.id.slice(0, 4).toUpperCase()}`;

  const subtotal       = payload.cart_snapshot.reduce(
    (s, item) => s + item.unit_price * item.quantity, 0,
  );
  const discountAmount = payload.discount_amount ?? 0;
  const totalAmount    = subtotal - discountAmount;
  const profitAmount   = payload.cart_snapshot.reduce(
    (s, item) => s + (item.unit_price - item.unit_cost) * item.quantity, 0,
  );

  const items: OrderItem[] = payload.cart_snapshot.map((item: CartItem) => ({
    product_id:    item.product_id,
    product_name:  item.name,
    unit_price:    item.unit_price,
    unit_cost:     item.unit_cost,
    quantity:      item.quantity,
    subtotal:      item.unit_price * item.quantity,
    notes:         item.notes || null,
    modifiers:     item.modifiers.map((m) => ({
      modifier_id:   m.modifier_id,
      modifier_name: m.modifier_name,
      group_name:    m.group_name,
      price_delta:   m.price_delta,
      recipe_lines:  m.recipe_lines ?? [],
    })),
    // Snapshot for stock reversal on void
    tracking_mode: item.tracking_mode ?? 'none',
    stock_item_id: item.stock_item_id ?? null,
    recipe_lines:  item.recipe_lines ?? [],
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

  // Wait for Firebase Auth to restore its persisted session, then force-refresh
  // the ID token to prevent stale-token permission rejections.
  const fbUser = await ensureAuthenticated();
  if (fbUser) {
    try {
      await fbUser.getIdToken(true);
    } catch (err) {
      logError('createOrder:tokenRefresh', err, `uid=${fbUser.uid} token refresh failed`);
      throw err;
    }
  } else {
    logError('createOrder:tokenRefresh', null, 'No signed-in user after waiting for auth restore');
    throw new Error('User not authenticated');
  }

  // ── 1. Commit the order record (must succeed) ────────────────────────────
  const orderBatch = writeBatch(db);
  // merge:true makes idempotent syncs safe — re-syncing the same local_id
  // simply overwrites with identical data instead of failing.
  orderBatch.set(newRef, orderData, { merge: true });
  await orderBatch.commit();

  // ── 2. Deduct stock (non-fatal: permission issues must not block the order) ─
  try {
    const stockBatch = writeBatch(db);
    let hasStockOps  = false;

    for (const item of payload.cart_snapshot) {
      if (item.tracking_mode === 'direct' && item.stock_item_id) {
        stockBatch.update(stockDoc(item.stock_item_id), {
          quantity_on_hand: increment(-item.quantity),
        });
        hasStockOps = true;
      } else if (item.tracking_mode === 'recipe' && item.recipe_lines?.length) {
        for (const line of item.recipe_lines) {
          if (line.stock_item_id && line.quantity_required > 0) {
            stockBatch.update(stockDoc(line.stock_item_id), {
              quantity_on_hand: increment(-(line.quantity_required * item.quantity)),
            });
            hasStockOps = true;
          }
        }
      }
      for (const mod of item.modifiers) {
        for (const line of (mod.recipe_lines ?? [])) {
          if (line.stock_item_id && line.quantity_required > 0) {
            stockBatch.update(stockDoc(line.stock_item_id), {
              quantity_on_hand: increment(-(line.quantity_required * item.quantity)),
            });
            hasStockOps = true;
          }
        }
      }
    }

    if (hasStockOps) await stockBatch.commit();
  } catch (err) {
    // Stock deduction failed (likely a Firestore rules issue on stock_items).
    // The order is already saved — log for visibility but do not throw.
    logError('createOrder:stockDeduction', err, `Order ${newRef.id} saved but stock deduction failed`);
  }

  // ── 3. Update session cash collected (non-fatal) ─────────────────────────
  // Skip if session.id is a draft UUID (contains hyphens) — the document
  // doesn't exist in Firestore. syncPendingOrders handles the consolidated
  // cash update for offline orders after reconciliation.
  if (payload.payment_method === 'cash' && !session.id.includes('-')) {
    await updateDoc(sessionDoc(session.id), {
      cash_collected: increment(totalAmount),
      expected_cash:  increment(totalAmount),
    }).catch((err) => logError('createOrder:sessionCash', err, `Order ${newRef.id} cash update failed`));
  }

  return { id: newRef.id, ...orderData };
}

export async function voidOrder(orderId: string): Promise<void> {
  const snap = await getDoc(orderDoc(orderId));
  if (!snap.exists()) return;
  const order = { id: snap.id, ...(snap.data() as Omit<Order, 'id'>) };

  const batch = writeBatch(db);
  batch.update(orderDoc(orderId), { status: 'cancelled', payment_status: 'unpaid' });

  // Reverse cash collected on the session
  if (order.payment_method === 'cash' && order.session_id) {
    batch.update(sessionDoc(order.session_id), {
      cash_collected: increment(-order.total_amount),
      expected_cash:  increment(-order.total_amount),
    });
  }

  // Reverse stock deductions using the snapshot stored at order time
  for (const item of order.items) {
    if (item.tracking_mode === 'direct' && item.stock_item_id) {
      batch.update(stockDoc(item.stock_item_id), {
        quantity_on_hand: increment(item.quantity),
      });
    } else if (item.tracking_mode === 'recipe' && item.recipe_lines?.length) {
      for (const line of item.recipe_lines) {
        if (line.stock_item_id && line.quantity_required > 0) {
          batch.update(stockDoc(line.stock_item_id), {
            quantity_on_hand: increment(line.quantity_required * item.quantity),
          });
        }
      }
    }

    // Reverse modifier recipe line deductions
    for (const mod of item.modifiers) {
      for (const line of (mod.recipe_lines ?? [])) {
        if (line.stock_item_id && line.quantity_required > 0) {
          batch.update(stockDoc(line.stock_item_id), {
            quantity_on_hand: increment(line.quantity_required * item.quantity),
          });
        }
      }
    }
  }

  await batch.commit();
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

// Fetches products from Firestore and writes them to the local cache (awaited).
// Returns the fresh product list, or throws on failure.
async function fetchAndCacheProducts(): Promise<Product[]> {
  // Re-establish Firebase auth if needed (e.g. after offline login or token expiry).
  // Without this, Firestore rejects the query with permission-denied.
  await ensureAuthenticated();

  const [prodSnap, stockSnap] = await Promise.all([
    getDocs(query(productsCol(), where('is_active', '==', true))),
    getDocs(stockCol()),
  ]);

  const stockMap = new Map<string, { qty: number; reorder: number }>();
  const stockItems: StockItem[] = [];
  for (const d of stockSnap.docs) {
    const data    = d.data() as DocumentData;
    const qty     = (data.quantity_on_hand as number) ?? 0;
    const reorder = (data.reorder_level    as number) ?? 0;
    stockMap.set(d.id, { qty, reorder });
    stockItems.push({
      id:               d.id,
      name:             (data.name          as string) ?? '',
      unit:             (data.unit          as string) ?? '',
      quantity_on_hand: qty,
      reorder_level:    reorder,
      cost_per_unit:    (data.cost_per_unit as number) ?? 0,
      is_active:        data.is_active !== false,
      stock_status:     qty <= 0 ? 'out' : reorder > 0 && qty <= reorder ? 'low' : 'ok',
    });
  }

  const products = prodSnap.docs.map((d) => {
    const data         = d.data() as DocumentData;
    const trackingMode = data.tracking_mode as Product['tracking_mode'];
    const stockItemId  = data.stock_item_id as string | null;

    let stock_status: Product['stock_status'] = 'ok';
    if (trackingMode === 'direct' && stockItemId) {
      const si = stockMap.get(stockItemId);
      if (si) {
        stock_status = si.qty <= 0 ? 'out'
          : (si.reorder > 0 && si.qty <= si.reorder) ? 'low'
          : 'ok';
      }
    }

    return {
      id:              d.id,
      ...(data        as Omit<Product, 'id'>),
      stock_status,
      modifier_groups: (data.modifier_groups as Product['modifier_groups']) ?? [],
      recipe_lines:    (data.recipe_lines    as Product['recipe_lines'])   ?? [],
    };
  });

  // Await the write so it is guaranteed to complete before we return.
  await writeProductsCache(products);
  replaceStockCache(stockItems).catch(() => {});
  return products;
}

// Stale-while-revalidate: serve from cache immediately if available,
// refresh from Firestore in the background. Falls back to cache-only when offline.
export async function getProducts(): Promise<Product[]> {
  const cached = await getCachedProducts();

  if (cached.length > 0) {
    // Return cached data immediately, refresh in background when online.
    fetchAndCacheProducts().catch(() => {});
    return cached;
  }

  // No cache yet — must fetch live (first online launch).
  try {
    return await fetchAndCacheProducts();
  } catch (err) {
    logError('getProducts:fetch', err, 'Firestore fetch failed, cache is empty');
    return [];
  }
}

export async function getCategories(): Promise<Category[]> {
  const cached = await getCachedCategories();

  if (cached.length > 0) {
    // Return cached data immediately, refresh in background.
    (async () => {
      try {
        const q    = query(categoriesCol(), where('is_active', '==', true));
        const snap = await getDocs(q);
        const fresh = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Category, 'id'>) }))
          .sort((a, b) => a.sort_order - b.sort_order);
        await writeCategoriesCache(fresh);
      } catch { /* stay on cached */ }
    })();
    return cached;
  }

  // No cache — fetch live.
  try {
    const q    = query(categoriesCol(), where('is_active', '==', true));
    const snap = await getDocs(q);
    const categories = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<Category, 'id'>) }))
      .sort((a, b) => a.sort_order - b.sort_order);
    await writeCategoriesCache(categories);
    return categories;
  } catch {
    return [];
  }
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

export async function deleteProduct(id: string): Promise<void> {
  const { deleteDoc } = await import('firebase/firestore');
  await deleteDoc(productDoc(id));
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
  const completedQ   = query(ordersCol(), where('status', '==', 'completed'));
  const cancelledQ   = query(ordersCol(), where('status', '==', 'cancelled'));
  const pendingQ     = query(ordersCol(), where('status', '==', 'pending'));

  const [agg, cancelledCount, pendingCount] = await Promise.all([
    getAggregateFromServer(completedQ, {
      total_revenue: sum('total_amount'),
      total_profit:  sum('profit_amount'),
      total_orders:  count(),
    }),
    getCountFromServer(cancelledQ),
    getCountFromServer(pendingQ),
  ]);

  const completedCount = agg.data().total_orders ?? 0;
  const by_status = [
    { status: 'completed',  count: completedCount },
    { status: 'cancelled',  count: cancelledCount.data().count },
    { status: 'pending',    count: pendingCount.data().count },
  ].filter((s) => s.count > 0);

  return {
    total_revenue: agg.data().total_revenue ?? 0,
    total_profit:  agg.data().total_profit  ?? 0,
    total_orders:  completedCount,
    by_status,
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
