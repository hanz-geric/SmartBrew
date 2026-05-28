import { collection, doc } from 'firebase/firestore';
import { db } from './config';

// Collection references (functions so they're evaluated lazily after Firebase init)
export const usersCol      = () => collection(db, 'users');
export const productsCol   = () => collection(db, 'products');
export const categoriesCol = () => collection(db, 'categories');
export const ordersCol     = () => collection(db, 'orders');
export const sessionsCol   = () => collection(db, 'cash_sessions');
export const stockCol      = () => collection(db, 'stock_items');
export const modGroupsCol  = () => collection(db, 'modifier_groups');

// Document references
export const userDoc          = (uid: string)      => doc(db, 'users', uid);
export const productDoc       = (id: string)       => doc(db, 'products', id);
export const categoryDoc      = (id: string)       => doc(db, 'categories', id);
export const modGroupDoc      = (id: string)       => doc(db, 'modifier_groups', id);
export const orderDoc         = (id: string)       => doc(db, 'orders', id);
export const sessionDoc       = (id: string)       => doc(db, 'cash_sessions', id);
export const stockDoc         = (id: string)       => doc(db, 'stock_items', id);
export const settingsDoc      = ()                 => doc(db, 'settings', 'config');
export const loginAttemptDoc  = (username: string) => doc(db, 'login_attempts', username);
