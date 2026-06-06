import { collection, doc } from 'firebase/firestore'
import { db } from './config'

export const usersCol      = () => collection(db, 'users')
export const ordersCol     = () => collection(db, 'orders')
export const sessionsCol   = () => collection(db, 'cash_sessions')
export const productsCol   = () => collection(db, 'products')
export const categoriesCol = () => collection(db, 'categories')
export const modGroupsCol  = () => collection(db, 'modifier_groups')
export const stockCol      = () => collection(db, 'stock_items')

export const userDoc     = (uid: string) => doc(db, 'users', uid)
export const settingsDoc = ()            => doc(db, 'settings', 'config')
