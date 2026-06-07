import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  query, where, orderBy, limit, startAfter, getDocs, updateDoc, doc,
  getAggregateFromServer, getCountFromServer, sum, count,
  type QueryDocumentSnapshot, type DocumentData,
} from 'firebase/firestore'
import { db } from '@/firebase/config'
import { ordersCol } from '@/firebase/collections'
import { useAuth } from '@/context/AuthContext'
import type { Order, PaymentMethod, OrderType } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderFilters {
  payment_method?: PaymentMethod
  order_type?:     OrderType
}

interface OrdersSummary {
  activeCount: number
  voidedCount: number
  revenue:     number
  profit:      number
}

interface OrdersPage {
  orders:  Order[]
  cursor:  QueryDocumentSnapshot<DocumentData> | null
  hasMore: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

type Period = 'today' | 'yesterday' | 'week' | 'month'

const PERIODS: { value: Period; label: string }[] = [
  { value: 'today',     label: 'Today'      },
  { value: 'yesterday', label: 'Yesterday'  },
  { value: 'week',      label: 'This Week'  },
  { value: 'month',     label: 'This Month' },
]

const PAY_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', qr: 'QR', gift_card: 'Gift Card', pay_later: 'Pay Later',
}

const TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine In', takeaway: 'Takeaway', delivery: 'Delivery',
}

const PAGE_SIZE = 50

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getRange(period: Period): { start: string; end: string } {
  const now   = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (period) {
    case 'today':
      return {
        start: today.toISOString(),
        end:   new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString(),
      }
    case 'yesterday': {
      const d = new Date(today); d.setDate(d.getDate() - 1)
      return {
        start: d.toISOString(),
        end:   new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString(),
      }
    }
    case 'week': {
      const s = new Date(today); s.setDate(s.getDate() - 6)
      return { start: s.toISOString(), end: now.toISOString() }
    }
    case 'month': {
      return {
        start: new Date(today.getFullYear(), today.getMonth(), 1).toISOString(),
        end:   now.toISOString(),
      }
    }
  }
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function downloadCsv(orders: Order[], includeProfit: boolean) {
  const headers = ['Order #', 'Date', 'Cashier', 'Type', 'Payment', 'Total', ...(includeProfit ? ['Profit'] : []), 'Status']
  const rows = orders.map(o => [
    o.order_number,
    new Date(o.created_at).toLocaleString('en-PH'),
    o.cashier_name ?? '',
    TYPE_LABELS[o.order_type] ?? o.order_type,
    PAY_LABELS[o.payment_method] ?? o.payment_method,
    o.total_amount.toFixed(2),
    ...(includeProfit ? [(o.profit_amount ?? 0).toFixed(2)] : []),
    o.status === 'cancelled' ? 'Voided' : 'Active',
  ])
  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const a    = document.createElement('a')
  a.href     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `orders_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
}

// ─── Firestore helpers ────────────────────────────────────────────────────────

function baseConstraints(start: string, end: string, filters: OrderFilters) {
  return [
    where('created_at', '>=', start),
    where('created_at', '<=', end),
    ...(filters.payment_method ? [where('payment_method', '==', filters.payment_method)] : []),
    ...(filters.order_type     ? [where('order_type',     '==', filters.order_type)]     : []),
  ]
}

async function fetchSummary(start: string, end: string, filters: OrderFilters): Promise<OrdersSummary> {
  const base = baseConstraints(start, end, filters)
  const [activeAgg, voidedAgg] = await Promise.all([
    getAggregateFromServer(
      query(ordersCol(), ...base, where('status', '==', 'completed')),
      { revenue: sum('total_amount'), profit: sum('profit_amount'), activeCount: count() },
    ),
    getCountFromServer(query(ordersCol(), ...base, where('status', '==', 'cancelled'))),
  ])
  return {
    activeCount: activeAgg.data().activeCount ?? 0,
    voidedCount: voidedAgg.data().count       ?? 0,
    revenue:     activeAgg.data().revenue     ?? 0,
    profit:      activeAgg.data().profit      ?? 0,
  }
}

async function fetchPage(
  start: string, end: string,
  filters: OrderFilters,
  cursor: QueryDocumentSnapshot<DocumentData> | null,
): Promise<OrdersPage> {
  const snap = await getDocs(query(ordersCol(),
    ...baseConstraints(start, end, filters),
    orderBy('created_at', 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(PAGE_SIZE),
  ))
  return {
    orders:  snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Order, 'id'>) })),
    cursor:  snap.docs.at(-1) ?? null,
    hasMore: snap.docs.length === PAGE_SIZE,
  }
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export default function OrdersPanel({ exportRef }: { exportRef?: MutableRefObject<(() => void) | null> }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const canVoid = user?.role === 'admin' || user?.role === 'manager'

  const [period,      setPeriod]      = useState<Period>('today')
  const [payFilter,   setPayFilter]   = useState<PaymentMethod | 'all'>('all')
  const [typeFilter,  setTypeFilter]  = useState<OrderType | 'all'>('all')
  const [search,      setSearch]      = useState('')
  const [orders,      setOrders]      = useState<Order[]>([])
  const [summary,     setSummary]     = useState<OrdersSummary | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore,     setHasMore]     = useState(false)
  const [error,       setError]       = useState('')
  const [expanded,    setExpanded]    = useState<string | null>(null)
  const [voiding,     setVoiding]     = useState<string | null>(null)
  const [voidTarget,  setVoidTarget]  = useState<Order | null>(null)
  const [exporting,   setExporting]   = useState(false)

  const cursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null)

  function filters(): OrderFilters {
    return {
      payment_method: payFilter  !== 'all' ? payFilter  as PaymentMethod : undefined,
      order_type:     typeFilter !== 'all' ? typeFilter as OrderType     : undefined,
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setExpanded(null)
    setSummary(null)
    cursorRef.current = null
    const f            = filters()
    const { start, end } = getRange(period)
    fetchSummary(start, end, f).then(setSummary).catch(() => {})
    try {
      const page = await fetchPage(start, end, f, null)
      setOrders(page.orders)
      cursorRef.current = page.cursor
      setHasMore(page.hasMore)
    } catch {
      setError('Failed to load orders.')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, payFilter, typeFilter])

  useEffect(() => { load() }, [load])

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    const { start, end } = getRange(period)
    try {
      const page = await fetchPage(start, end, filters(), cursorRef.current)
      setOrders(prev => [...prev, ...page.orders])
      cursorRef.current = page.cursor
      setHasMore(page.hasMore)
    } catch {
      // keep existing rows
    } finally {
      setLoadingMore(false)
    }
  }

  async function doVoid(orderId: string) {
    setVoiding(orderId)
    try {
      await updateDoc(doc(db, 'orders', orderId), { status: 'cancelled', payment_status: 'unpaid' })
      setOrders(prev =>
        prev.map(o => o.id === orderId ? { ...o, status: 'cancelled' as const, payment_status: 'unpaid' as const } : o),
      )
      const { start, end } = getRange(period)
      fetchSummary(start, end, filters()).then(setSummary).catch(() => {})
    } catch {
      // silently fail
    } finally {
      setVoiding(null)
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const { start, end } = getRange(period)
      const f    = filters()
      const all: Order[] = []
      let cursor: QueryDocumentSnapshot<DocumentData> | null = null
      for (let i = 0; i < 200; i++) {
        const page = await fetchPage(start, end, f, cursor)
        all.push(...page.orders)
        if (!page.hasMore) break
        cursor = page.cursor
      }
      const q    = search.trim().toLowerCase()
      const rows = q ? all.filter(o => o.order_number.toLowerCase().includes(q)) : all
      if (rows.length) downloadCsv(rows, isAdmin)
    } catch {
      // silently fail
    } finally {
      setExporting(false)
    }
  }

  const q       = search.trim().toLowerCase()
  const visible = q ? orders.filter(o => o.order_number.toLowerCase().includes(q)) : orders

  if (exportRef) exportRef.current = handleExport
  useEffect(() => () => { if (exportRef) exportRef.current = null }, [exportRef])

  return (
    <>
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 bg-white" style={{ borderBottom: '1px solid #e5e7eb' }}>
        {/* Filter rows */}
        <div className="px-4 pt-2.5 pb-2 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <select
              value={period}
              onChange={e => { setPeriod(e.target.value as Period); setExpanded(null) }}
              className="text-sm rounded-md px-2 py-1.5 outline-none cursor-pointer shrink-0"
              style={{ border: '1px solid #e5e7eb', color: '#374151', background: '#ffffff' }}
            >
              {PERIODS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <select
              value={payFilter}
              onChange={e => { setPayFilter(e.target.value as PaymentMethod | 'all'); setExpanded(null) }}
              className="text-sm rounded-md px-2 py-1.5 outline-none cursor-pointer shrink-0"
              style={{
                border:     '1px solid #e5e7eb',
                color:      payFilter !== 'all' ? '#15803d' : '#9ca3af',
                background: payFilter !== 'all' ? '#f0fdf4' : '#ffffff',
              }}
            >
              <option value="all">All payment</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="qr">QR</option>
              <option value="gift_card">Gift Card</option>
              <option value="pay_later">Pay Later</option>
            </select>
            <select
              value={typeFilter}
              onChange={e => { setTypeFilter(e.target.value as OrderType | 'all'); setExpanded(null) }}
              className="text-sm rounded-md px-2 py-1.5 outline-none cursor-pointer shrink-0"
              style={{
                border:     '1px solid #e5e7eb',
                color:      typeFilter !== 'all' ? '#15803d' : '#9ca3af',
                background: typeFilter !== 'all' ? '#f0fdf4' : '#ffffff',
              }}
            >
              <option value="all">All type</option>
              <option value="dine_in">Dine In</option>
              <option value="takeaway">Takeaway</option>
              <option value="delivery">Delivery</option>
            </select>
          </div>
          <input
            type="text"
            placeholder="Search order #…"
            value={search}
            onChange={e => { setSearch(e.target.value); setExpanded(null) }}
            className="w-full text-sm rounded-md px-3 py-1.5 outline-none focus:ring-2 focus:ring-green-600"
            style={{ border: '1px solid #d1d5db', color: '#111827' }}
          />
        </div>

        {/* Summary bar */}
        {!loading && !error && summary && (
          <div
            className="flex items-center justify-between px-4 py-2 flex-wrap gap-2"
            style={{ background: '#f0fdf4', borderTop: '1px solid #bbf7d0' }}
          >
            <span className="text-sm font-medium" style={{ color: '#15803d' }}>
              {summary.activeCount} order{summary.activeCount !== 1 ? 's' : ''}
              {summary.voidedCount > 0 && ` · ${summary.voidedCount} voided`}
            </span>
            <div className="flex items-center gap-4">
              <span className="text-sm font-bold" style={{ color: '#15803d' }}>
                ₱{summary.revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })} revenue
              </span>
              {isAdmin && (
                <span className="text-sm font-bold" style={{ color: '#2563eb' }}>
                  ₱{summary.profit.toLocaleString('en-PH', { minimumFractionDigits: 2 })} profit
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="px-3 py-4 sm:px-4" style={{ background: '#f9fafb', minHeight: '100%' }}>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-sm" style={{ color: '#9ca3af' }}>Loading…</span>
          </div>
        ) : error ? (
          <div className="rounded-lg p-4 text-sm max-w-lg mx-auto" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
            {error}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-center py-20 text-sm" style={{ color: '#9ca3af' }}>
            No orders for this period.
          </p>
        ) : (
          <div className="flex flex-col gap-2 max-w-4xl mx-auto">
            {visible.map(order => {
              const isOpen        = expanded === order.id
              const isVoided      = order.status === 'cancelled'
              const isVoidingThis = voiding === order.id

              return (
                <div
                  key={order.id}
                  className="bg-white rounded-lg shadow-sm"
                  style={{ border: '1px solid #e5e7eb', opacity: isVoided ? 0.65 : 1 }}
                >
                  <div
                    className="flex items-center gap-3 p-4 cursor-pointer select-none"
                    onClick={() => setExpanded(isOpen ? null : order.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-sm font-bold"
                          style={{
                            color:          isVoided ? '#9ca3af' : '#111827',
                            textDecoration: isVoided ? 'line-through' : 'none',
                          }}
                        >
                          #{order.order_number}
                        </span>
                        {isVoided && (
                          <span
                            className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}
                          >
                            Voided
                          </span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5 truncate" style={{ color: '#6b7280' }}>
                        {fmtDateTime(order.created_at)}
                        {' · '}{TYPE_LABELS[order.order_type] ?? order.order_type}
                        {order.table_number ? ` · ${order.table_number}` : ''}
                        {order.cashier_name ? ` · ${order.cashier_name}` : ''}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span
                        className="text-lg font-extrabold"
                        style={{
                          color:          isVoided ? '#9ca3af' : '#15803d',
                          textDecoration: isVoided ? 'line-through' : 'none',
                        }}
                      >
                        ₱{order.total_amount.toFixed(2)}
                      </span>
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full" style={{ background: '#f3f4f6', color: '#6b7280' }}>
                        {PAY_LABELS[order.payment_method] ?? order.payment_method}
                      </span>
                    </div>

                    <span className="text-xs ml-1 shrink-0" style={{ color: '#9ca3af' }}>
                      {isOpen ? '▲' : '▼'}
                    </span>
                  </div>

                  {isOpen && (
                    <div className="px-4 pb-4" onClick={e => e.stopPropagation()}>
                      <div className="border-t mb-3" style={{ borderColor: '#e5e7eb' }} />

                      {order.items.map((item, idx) => (
                        <div key={idx} className="flex items-start gap-2 py-1">
                          <span className="flex-1 text-sm" style={{ color: '#374151' }}>
                            {item.product_name}
                            {item.modifiers.length > 0 && (
                              <span style={{ color: '#9ca3af' }}>
                                {' ('}
                                {item.modifiers.map(m => m.modifier_name).join(', ')}
                                {')'}
                              </span>
                            )}
                            {item.notes && (
                              <span className="block text-xs mt-0.5 italic" style={{ color: '#9ca3af' }}>
                                Note: {item.notes}
                              </span>
                            )}
                          </span>
                          <span className="text-sm w-8 text-center shrink-0" style={{ color: '#6b7280' }}>
                            ×{item.quantity}
                          </span>
                          <span className="text-sm font-semibold w-16 text-right shrink-0" style={{ color: '#111827' }}>
                            ₱{item.subtotal.toFixed(2)}
                          </span>
                        </div>
                      ))}

                      {order.discount_amount > 0 && (
                        <div className="flex justify-between items-center pt-2 mt-1 border-t" style={{ borderColor: '#e5e7eb' }}>
                          <span className="text-sm font-medium" style={{ color: '#dc2626' }}>Discount</span>
                          <span className="text-sm font-bold" style={{ color: '#dc2626' }}>
                            −₱{order.discount_amount.toFixed(2)}
                          </span>
                        </div>
                      )}

                      {canVoid && !isVoided && (
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => setVoidTarget(order)}
                            disabled={isVoidingThis}
                            className="px-3 py-1.5 rounded-md text-sm font-bold transition-opacity disabled:opacity-50"
                            style={{ border: '1.5px solid #dc2626', color: '#dc2626' }}
                          >
                            {isVoidingThis ? 'Voiding…' : 'Void Order'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}

            {hasMore && !search.trim() && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="py-3 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
                style={{ border: '1.5px solid #e5e7eb', background: '#ffffff', color: '#15803d' }}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Void confirm dialog ── */}
      {voidTarget && (
        <div
          className="fixed inset-0 flex items-center justify-center p-4 z-50"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setVoidTarget(null)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-bold mb-1" style={{ color: '#111827' }}>Void Order</h2>
            <p className="text-sm mb-5" style={{ color: '#6b7280' }}>
              Void order #{voidTarget.order_number}? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setVoidTarget(null)}
                className="px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ border: '1px solid #e5e7eb', color: '#374151' }}
              >
                Cancel
              </button>
              <button
                onClick={() => { const id = voidTarget.id; setVoidTarget(null); doVoid(id) }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ background: '#dc2626' }}
              >
                Void Order
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
