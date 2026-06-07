import { useCallback, useEffect, useState } from 'react'
import { query, where, orderBy, limit, getDocs } from 'firebase/firestore'
import { ordersCol, sessionsCol } from '@/firebase/collections'
import { useAuth } from '@/context/AuthContext'
import type { CashSession, CashierEvent, Order, RosterEntry } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type SessionPeriod = 'today' | 'week' | 'month' | 'all'
type DetailTab     = 'cashiers' | 'products' | 'orders'

interface ProductStat {
  name:       string
  qty:        number
  revenue:    number
  orderCount: number
}

interface CashierStat {
  entry:         RosterEntry
  orderCount:    number
  revenue:       number
  cashCollected: number
  voidedCount:   number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PERIODS: { value: SessionPeriod; label: string }[] = [
  { value: 'today', label: 'Today'      },
  { value: 'week',  label: 'This Week'  },
  { value: 'month', label: 'This Month' },
  { value: 'all',   label: 'All'        },
]

const PAY_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', qr: 'QR', gift_card: 'Gift Card', pay_later: 'Pay Later',
}

const TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine In', takeaway: 'Takeaway', delivery: 'Delivery',
}

const ACTION_LABEL: Record<string, string> = {
  open:       'Opened session',
  clock_in:   'Clocked in',
  switch_in:  'Switched in',
  switch_out: 'Switched out',
  clock_out:  'Clocked out',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSessionRange(period: SessionPeriod): { start: string; end: string } | null {
  if (period === 'all') return null
  const now   = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (period) {
    case 'today':
      return {
        start: today.toISOString(),
        end:   new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString(),
      }
    case 'week': {
      const s = new Date(today); s.setDate(s.getDate() - 6)
      return { start: s.toISOString(), end: now.toISOString() }
    }
    case 'month':
      return {
        start: new Date(today.getFullYear(), today.getMonth(), 1).toISOString(),
        end:   now.toISOString(),
      }
  }
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function duration(start: string, end: string | null): string {
  if (!end) return 'Open'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const h  = Math.floor(ms / 3_600_000)
  const m  = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function initials(name: string): string {
  return name.split(' ').map(n => n[0] ?? '').join('').toUpperCase().slice(0, 2)
}

function buildProductStats(orders: Order[]): ProductStat[] {
  const map: Record<string, ProductStat> = {}
  for (const order of orders) {
    if (order.status === 'cancelled') continue
    for (const item of order.items ?? []) {
      if (!map[item.product_name]) {
        map[item.product_name] = { name: item.product_name, qty: 0, revenue: 0, orderCount: 0 }
      }
      map[item.product_name].qty        += item.quantity
      map[item.product_name].revenue    += item.subtotal
      map[item.product_name].orderCount += 1
    }
  }
  return Object.values(map).sort((a, b) => b.qty - a.qty)
}

function buildCashierStats(roster: RosterEntry[], orders: Order[]): CashierStat[] {
  return roster.map(entry => {
    const mine   = orders.filter(o => o.cashier_name === entry.full_name)
    const active = mine.filter(o => o.status !== 'cancelled')
    return {
      entry,
      orderCount:    active.length,
      revenue:       active.reduce((s, o) => s + o.total_amount, 0),
      cashCollected: active.filter(o => o.payment_method === 'cash').reduce((s, o) => s + o.total_amount, 0),
      voidedCount:   mine.length - active.length,
    }
  })
}

function downloadSessionsCsv(sessions: CashSession[]) {
  const headers = ['Cashier', 'Opened', 'Closed', 'Starting Cash', 'Cash Collected', 'Expected', 'Actual', 'Difference', 'Status']
  const rows = sessions.map(s => [
    s.cashier_name,
    fmtDateTime(s.start_time),
    s.end_time ? fmtDateTime(s.end_time) : '',
    s.starting_cash.toFixed(2),
    (s.cash_collected ?? 0).toFixed(2),
    s.expected_cash != null ? s.expected_cash.toFixed(2) : '',
    s.actual_cash   != null ? s.actual_cash.toFixed(2)   : '',
    s.difference    != null ? s.difference.toFixed(2)    : '',
    s.status === 'open' ? 'Open' : 'Closed',
  ])
  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const a    = document.createElement('a')
  a.href     = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = `sessions_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
}

// ─── Firestore helpers ────────────────────────────────────────────────────────

async function fetchSessions(period: SessionPeriod): Promise<CashSession[]> {
  const range = getSessionRange(period)
  const snap = range
    ? await getDocs(query(
        sessionsCol(),
        where('start_time', '>=', range.start),
        where('start_time', '<=', range.end),
        orderBy('start_time', 'desc'),
        limit(200),
      ))
    : await getDocs(query(sessionsCol(), orderBy('start_time', 'desc'), limit(100)))
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<CashSession, 'id'>) }))
}

async function fetchSessionOrders(sessionId: string): Promise<Order[]> {
  const snap = await getDocs(query(ordersCol(), where('session_id', '==', sessionId), limit(2000)))
  return snap.docs
    .map(d => ({ id: d.id, ...(d.data() as Omit<Order, 'id'>) }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

// ─── CashCell ─────────────────────────────────────────────────────────────────

function CashCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 flex flex-col items-center py-3 px-2" style={{ borderRight: '1px solid #e5e7eb' }}>
      <span className="text-xs font-medium mb-1" style={{ color: '#6b7280' }}>{label}</span>
      <span className="text-sm font-bold" style={{ color: '#111827' }}>{value}</span>
    </div>
  )
}

// ─── Chip ─────────────────────────────────────────────────────────────────────

function Chip({ label, green, blue, danger, warning }: {
  label: string; green?: boolean; blue?: boolean; danger?: boolean; warning?: boolean
}) {
  const bg   = danger ? '#fef2f2' : green  ? '#f0fdf4' : blue    ? '#eff6ff' : warning ? '#fef9c3' : '#f3f4f6'
  const text = danger ? '#dc2626' : green  ? '#15803d' : blue    ? '#2563eb' : warning ? '#854d0e' : '#6b7280'
  return (
    <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: bg, color: text }}>
      {label}
    </span>
  )
}

// ─── CashierCard ──────────────────────────────────────────────────────────────

function CashierCard({ stat, session }: { stat: CashierStat; session: CashSession }) {
  const { entry, orderCount, revenue, cashCollected, voidedCount } = stat
  const isActive = entry.status === 'active'
  const dur = entry.clock_out_at
    ? duration(entry.clock_in_at, entry.clock_out_at)
    : session.end_time
      ? duration(entry.clock_in_at, session.end_time)
      : 'Active'

  const roleColors: Record<string, { bg: string; text: string }> = {
    admin:   { bg: '#dcfce7', text: '#15803d' },
    manager: { bg: '#e0e7ff', text: '#4338ca' },
    cashier: { bg: '#f3f4f6', text: '#6b7280' },
  }
  const rc = roleColors[entry.role] ?? roleColors.cashier

  return (
    <div className="bg-white rounded-lg overflow-hidden" style={{ border: '1px solid #e5e7eb' }}>
      <div className="flex items-start gap-3 p-4">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-sm font-bold"
          style={{ background: isActive ? '#dcfce7' : '#f3f4f6', color: isActive ? '#15803d' : '#6b7280' }}
        >
          {initials(entry.full_name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center flex-wrap gap-1.5 mb-1">
            <span className="text-sm font-semibold" style={{ color: '#111827' }}>{entry.full_name}</span>
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full capitalize" style={{ background: rc.bg, color: rc.text }}>
              {entry.role}
            </span>
            {isActive && (
              <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#166534', color: '#ffffff' }}>
                Active
              </span>
            )}
          </div>
          <p className="text-xs" style={{ color: '#6b7280' }}>
            In: {fmtTime(entry.clock_in_at)}
            {entry.clock_out_at && `  ·  Out: ${fmtTime(entry.clock_out_at)}`}
            {'  ·  '}{dur}
          </p>
        </div>
      </div>
      <div className="flex" style={{ borderTop: '1px solid #f3f4f6', background: '#f9fafb' }}>
        {[
          { label: 'Orders',  value: String(orderCount) },
          { label: 'Revenue', value: `₱${revenue.toFixed(2)}` },
          { label: 'Cash',    value: `₱${cashCollected.toFixed(2)}` },
          ...(voidedCount > 0 ? [{ label: 'Voided', value: String(voidedCount), danger: true }] : []),
        ].map((item, i, arr) => (
          <div
            key={item.label}
            className="flex-1 flex flex-col items-center py-3"
            style={{ borderRight: i < arr.length - 1 ? '1px solid #f3f4f6' : 'none' }}
          >
            <span
              className="text-sm font-bold mb-0.5"
              style={{ color: 'danger' in item && item.danger ? '#dc2626' : '#111827' }}
            >
              {item.value}
            </span>
            <span className="text-xs" style={{ color: '#9ca3af' }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── SessionDetail ────────────────────────────────────────────────────────────

function SessionDetail({ session, onBack }: { session: CashSession; onBack: () => void }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [tab,     setTab]     = useState<DetailTab>('cashiers')
  const [orders,  setOrders]  = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchSessionOrders(session.id)
      .then(setOrders)
      .finally(() => setLoading(false))
  }, [session.id])

  const activeOrders  = orders.filter(o => o.status !== 'cancelled')
  const voidedCount   = orders.length - activeOrders.length
  const revenue       = activeOrders.reduce((s, o) => s + o.total_amount, 0)
  const cashCollected = activeOrders
    .filter(o => o.payment_method === 'cash')
    .reduce((s, o) => s + o.total_amount, 0)
  const profit = isAdmin ? activeOrders.reduce((s, o) => s + (o.profit_amount ?? 0), 0) : null

  const cashierNames = [...new Set(orders.map(o => o.cashier_name).filter(Boolean))]
  const hadSwitches  = cashierNames.length > 1
  const roster       = session.roster ?? []
  const cashierLog   = (session.cashier_log ?? []) as CashierEvent[]

  const cashierStats = buildCashierStats(
    roster.length > 0 ? roster : cashierNames.map(n => ({
      uid: n!, username: n!, full_name: n!, role: 'cashier' as const,
      clock_in_at:  session.start_time,
      clock_out_at: session.end_time,
      status: session.status === 'open' ? 'active' as const : 'clocked_out' as const,
    })),
    orders,
  )
  const productStats = buildProductStats(orders)
  const productTotal = productStats.reduce((s, p) => s + p.revenue, 0)

  return (
    <>
      <div className="bg-white px-6 py-4" style={{ borderBottom: '1px solid #e5e7eb' }}>
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <button onClick={onBack} className="text-sm font-medium mb-1 inline-block" style={{ color: '#15803d' }}>
              ‹ Back to Sessions
            </button>
            <h2 className="text-xl font-bold" style={{ color: '#111827' }}>{session.cashier_name}</h2>
            <p className="text-sm mt-0.5" style={{ color: '#6b7280' }}>
              {fmtDateTime(session.start_time)}
              {session.end_time && `  ·  Duration: ${duration(session.start_time, session.end_time)}`}
            </p>
          </div>
          <span
            className="text-xs font-bold px-2 py-1 rounded-full shrink-0 ml-4"
            style={{
              background: session.status === 'open' ? '#dcfce7' : '#f3f4f6',
              color:      session.status === 'open' ? '#15803d' : '#6b7280',
            }}
          >
            {session.status === 'open' ? 'Open' : 'Closed'}
          </span>
        </div>

        {!loading && (
          <div className="flex flex-wrap gap-2 mt-3">
            <Chip label={`${orders.length} orders`} />
            <Chip label={`₱${revenue.toFixed(2)} revenue`} green />
            <Chip label={`₱${cashCollected.toFixed(2)} cash`} />
            {profit !== null && <Chip label={`₱${profit.toFixed(2)} profit`} blue />}
            {voidedCount > 0 && <Chip label={`${voidedCount} voided`} danger />}
            {hadSwitches && <Chip label={`⇄ ${cashierNames.length} cashiers`} warning />}
          </div>
        )}

        <div className="mt-3 rounded-lg overflow-hidden" style={{ border: '1px solid #e5e7eb' }}>
          <div className="flex overflow-x-auto">
            <CashCell label="Starting"  value={`₱${session.starting_cash.toFixed(2)}`} />
            <CashCell label="Collected" value={`₱${(session.cash_collected ?? 0).toFixed(2)}`} />
            <CashCell label="Expected"  value={session.expected_cash != null ? `₱${session.expected_cash.toFixed(2)}` : '—'} />
            <CashCell label="Actual"    value={session.actual_cash   != null ? `₱${session.actual_cash.toFixed(2)}`   : '—'} />
          </div>
          {session.difference !== null && (
            <div
              className="flex items-center justify-between px-4 py-2 text-sm"
              style={{
                borderTop:  '1px solid #e5e7eb',
                background: session.difference > 0 ? '#eff6ff' : session.difference < 0 ? '#fef2f2' : '#f0fdf4',
              }}
            >
              <span className="font-semibold" style={{ color: '#374151' }}>
                {session.difference > 0 ? 'Over' : session.difference < 0 ? 'Short' : 'Exact'}
              </span>
              <span className="font-extrabold" style={{ color: session.difference > 0 ? '#2563eb' : session.difference < 0 ? '#dc2626' : '#15803d' }}>
                {session.difference === 0 ? '₱0.00' : `${session.difference > 0 ? '+' : ''}₱${session.difference.toFixed(2)}`}
              </span>
            </div>
          )}
        </div>

        {(session.opened_by_name || session.closed_by_name) && (
          <div className="flex gap-3 mt-3">
            {session.opened_by_name && (
              <div className="flex-1 rounded-lg p-3" style={{ border: '1px solid #e5e7eb' }}>
                <p className="text-xs" style={{ color: '#9ca3af' }}>Opened by</p>
                <p className="text-sm font-semibold" style={{ color: '#111827' }}>{session.opened_by_name}</p>
              </div>
            )}
            {session.closed_by_name && (
              <div className="flex-1 rounded-lg p-3" style={{ border: '1px solid #e5e7eb' }}>
                <p className="text-xs" style={{ color: '#9ca3af' }}>Closed by</p>
                <p className="text-sm font-semibold" style={{ color: '#111827' }}>{session.closed_by_name}</p>
              </div>
            )}
          </div>
        )}

        <div className="flex mt-3 rounded-lg overflow-hidden" style={{ border: '1px solid #e5e7eb' }}>
          {([
            { key: 'cashiers', label: `Cashiers${cashierStats.length > 0 ? ` (${cashierStats.length})` : ''}` },
            { key: 'products', label: 'Products' },
            { key: 'orders',   label: `Orders${orders.length > 0 ? ` (${orders.length})` : ''}` },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="flex-1 py-2.5 text-sm font-medium transition-colors"
              style={{
                background: tab === key ? '#166534' : '#ffffff',
                color:      tab === key ? '#ffffff'  : '#6b7280',
                fontWeight: tab === key ? '700'      : '500',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6" style={{ background: '#f9fafb', minHeight: '100%' }}>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-sm" style={{ color: '#9ca3af' }}>Loading orders…</span>
          </div>
        ) : tab === 'cashiers' ? (
          <div className="flex flex-col gap-4 max-w-3xl mx-auto">
            {cashierStats.length === 0 ? (
              <p className="text-center py-10 text-sm" style={{ color: '#9ca3af' }}>No cashier data.</p>
            ) : (
              cashierStats.map(stat => <CashierCard key={stat.entry.uid} stat={stat} session={session} />)
            )}
            {cashierLog.length > 0 && (
              <div className="bg-white rounded-lg overflow-hidden" style={{ border: '1px solid #e5e7eb' }}>
                <div className="px-4 py-2.5" style={{ background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                  <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Session Event Log</span>
                </div>
                {cashierLog.map((ev, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: i < cashierLog.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: ev.action === 'clock_out' || ev.action === 'switch_out' ? '#9ca3af' : '#16a34a' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: '#111827' }}>{ev.full_name}</p>
                      <p className="text-xs" style={{ color: '#6b7280' }}>{ACTION_LABEL[ev.action] ?? ev.action}</p>
                    </div>
                    <span className="text-xs font-medium shrink-0" style={{ color: '#9ca3af' }}>{fmtTime(ev.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : tab === 'products' ? (
          <div className="max-w-3xl mx-auto overflow-x-auto">
            <div className="bg-white rounded-lg overflow-hidden shadow-sm" style={{ border: '1px solid #e5e7eb', minWidth: '360px' }}>
              <div className="flex items-center px-4 py-2.5" style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <span className="flex-1 text-xs font-bold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Product</span>
                <span className="w-12 text-right text-xs font-bold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Qty</span>
                <span className="w-16 text-right text-xs font-bold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Orders</span>
                <span className="w-24 text-right text-xs font-bold uppercase tracking-wide" style={{ color: '#9ca3af' }}>Revenue</span>
              </div>
              {productStats.length === 0 ? (
                <p className="text-center py-10 text-sm" style={{ color: '#9ca3af' }}>No completed orders.</p>
              ) : (
                <>
                  {productStats.map(stat => (
                    <div key={stat.name} className="flex items-center px-4 py-3" style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <span className="flex-1 text-sm truncate" style={{ color: '#374151' }}>{stat.name}</span>
                      <span className="w-12 text-right text-sm" style={{ color: '#6b7280' }}>{stat.qty}</span>
                      <span className="w-16 text-right text-sm" style={{ color: '#6b7280' }}>{stat.orderCount}</span>
                      <span className="w-24 text-right text-sm font-medium" style={{ color: '#111827' }}>₱{stat.revenue.toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex items-center px-4 py-3" style={{ background: '#f0fdf4', borderTop: '1px solid #e5e7eb' }}>
                    <span className="flex-1 text-sm font-bold" style={{ color: '#15803d' }}>Total</span>
                    <span className="w-12" /><span className="w-16" />
                    <span className="w-24 text-right text-sm font-bold" style={{ color: '#15803d' }}>₱{productTotal.toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-w-3xl mx-auto">
            {orders.length === 0 ? (
              <p className="text-center py-10 text-sm" style={{ color: '#9ca3af' }}>No orders in this session.</p>
            ) : (
              orders.map(order => {
                const isVoided   = order.status === 'cancelled'
                const cashierTag = hadSwitches && order.cashier_name ? order.cashier_name : null
                return (
                  <div key={order.id} className="bg-white rounded-lg px-4 py-3 flex items-center gap-3" style={{ border: '1px solid #e5e7eb', opacity: isVoided ? 0.55 : 1 }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold" style={{ color: isVoided ? '#9ca3af' : '#111827', textDecoration: isVoided ? 'line-through' : 'none' }}>
                          #{order.order_number}
                        </span>
                        {cashierTag && (
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#fef9c3', color: '#854d0e', border: '1px solid rgba(133,77,14,0.2)' }}>
                            {cashierTag}
                          </span>
                        )}
                        {isVoided && (
                          <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#fef2f2', color: '#dc2626' }}>Voided</span>
                        )}
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: '#6b7280' }}>
                        {fmtTime(order.created_at)}{' · '}{TYPE_LABELS[order.order_type] ?? order.order_type}{' · '}{PAY_LABELS[order.payment_method] ?? order.payment_method}
                      </p>
                    </div>
                    <span className="text-sm font-bold shrink-0" style={{ color: isVoided ? '#9ca3af' : '#15803d', textDecoration: isVoided ? 'line-through' : 'none' }}>
                      ₱{order.total_amount.toFixed(2)}
                    </span>
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ─── SessionList ──────────────────────────────────────────────────────────────

function SessionList({ onSelect }: { onSelect: (s: CashSession) => void }) {
  const [period,       setPeriod]       = useState<SessionPeriod>('week')
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all')
  const [search,       setSearch]       = useState('')
  const [sessions,     setSessions]     = useState<CashSession[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [exporting,    setExporting]    = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setSessions(await fetchSessions(period)) }
    catch { setError('Failed to load sessions.') }
    finally { setLoading(false) }
  }, [period])

  useEffect(() => { load() }, [load])

  const visible = sessions.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false
    if (search.trim()) return s.cashier_name.toLowerCase().includes(search.trim().toLowerCase())
    return true
  })

  const openCount    = visible.filter(s => s.status === 'open').length
  const closedCount  = visible.filter(s => s.status === 'closed').length
  const totalCollect = visible.reduce((sum, s) => sum + (s.cash_collected ?? 0), 0)
  const variance     = visible.filter(s => s.difference !== null).reduce((sum, s) => sum + (s.difference ?? 0), 0)

  async function handleExport() {
    if (!visible.length) return
    setExporting(true)
    try { downloadSessionsCsv(visible) } finally { setExporting(false) }
  }

  return (
    <>
      {/* Filter row */}
      <div className="bg-white px-6 py-3 flex flex-wrap items-center gap-3" style={{ borderBottom: '1px solid #e5e7eb' }}>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold" style={{ color: '#9ca3af' }}>PERIOD</span>
          <select
            value={period}
            onChange={e => { setPeriod(e.target.value as SessionPeriod); setStatusFilter('all') }}
            className="text-sm font-semibold rounded-md px-2 py-1 outline-none cursor-pointer"
            style={{ border: '1px solid #e5e7eb', color: '#374151', background: '#ffffff' }}
          >
            {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        <div className="w-px h-4" style={{ background: '#e5e7eb' }} />

        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold" style={{ color: '#9ca3af' }}>STATUS</span>
          <div className="flex gap-1">
            {(['all', 'open', 'closed'] as const).map(f => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className="px-2.5 py-1 rounded-md text-xs font-semibold transition-colors"
                style={{
                  background: statusFilter === f ? '#f0fdf4' : '#f9fafb',
                  color:      statusFilter === f ? '#15803d' : '#6b7280',
                  border:     statusFilter === f ? '1px solid #16a34a' : '1px solid #e5e7eb',
                }}
              >
                {f === 'all' ? 'All' : f === 'open' ? 'Open' : 'Closed'}
              </button>
            ))}
          </div>
        </div>

        <input
          type="text"
          placeholder="Search by cashier…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[140px] text-sm rounded-md px-3 py-1 outline-none focus:ring-2 focus:ring-green-600"
          style={{ border: '1px solid #d1d5db', color: '#111827' }}
        />

        <div className="flex items-center gap-2 shrink-0">
          {!loading && visible.length > 0 && (
            <button onClick={handleExport} disabled={exporting} className="px-3 py-1 rounded-md text-sm font-semibold disabled:opacity-50" style={{ border: '1.5px solid #16a34a', color: '#15803d' }}>
              {exporting ? '…' : '⬇ Export'}
            </button>
          )}
          <button onClick={load} disabled={loading} className="px-3 py-1 rounded-md text-sm font-semibold disabled:opacity-50" style={{ border: '1px solid #e5e7eb', color: '#15803d' }}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Summary bar */}
      {!loading && !error && visible.length > 0 && (
        <div className="flex items-center justify-between px-6 py-2 flex-wrap gap-2" style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0' }}>
          <span className="text-sm font-medium" style={{ color: '#15803d' }}>
            {visible.length} session{visible.length !== 1 ? 's' : ''}
            {openCount   > 0 && ` · ${openCount} open`}
            {closedCount > 0 && ` · ${closedCount} closed`}
          </span>
          <div className="flex items-center gap-4">
            <span className="text-sm font-bold" style={{ color: '#15803d' }}>₱{totalCollect.toLocaleString('en-PH', { minimumFractionDigits: 2 })} collected</span>
            {variance !== 0 && (
              <span className="text-sm font-bold" style={{ color: variance > 0 ? '#2563eb' : '#dc2626' }}>
                {variance > 0 ? '▲' : '▼'} ₱{Math.abs(variance).toFixed(2)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* List */}
      <div className="p-4" style={{ background: '#f9fafb', minHeight: '100%' }}>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-sm" style={{ color: '#9ca3af' }}>Loading…</span>
          </div>
        ) : error ? (
          <div className="rounded-lg p-4 text-sm max-w-lg mx-auto" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>{error}</div>
        ) : visible.length === 0 ? (
          <p className="text-center py-20 text-sm" style={{ color: '#9ca3af' }}>No sessions found.</p>
        ) : (
          <div className="flex flex-col gap-3 max-w-4xl mx-auto">
            {visible.map(sess => {
              const diff    = sess.difference
              const isOpen  = sess.status === 'open'
              const isOver  = diff !== null && diff > 0
              const isShort = diff !== null && diff < 0
              const isExact = diff !== null && diff === 0
              return (
                <div key={sess.id} className="bg-white rounded-lg shadow-sm cursor-pointer hover:shadow-md transition-shadow" style={{ border: `1px solid ${isOpen ? '#4ade80' : '#e5e7eb'}` }} onClick={() => onSelect(sess)}>
                  <div className="flex items-start justify-between p-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-bold truncate" style={{ color: '#111827' }}>{sess.cashier_name}</p>
                      <p className="text-sm mt-0.5" style={{ color: '#6b7280' }}>
                        {fmtDateTime(sess.start_time)}
                        {sess.end_time ? ` → ${fmtTime(sess.end_time)}  ·  ${duration(sess.start_time, sess.end_time)}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 ml-3 shrink-0">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: isOpen ? '#dcfce7' : '#f3f4f6', color: isOpen ? '#15803d' : '#6b7280' }}>
                        {isOpen ? 'Open' : 'Closed'}
                      </span>
                      <span className="text-xs font-medium" style={{ color: '#16a34a' }}>View ›</span>
                    </div>
                  </div>
                  <div className="flex overflow-x-auto" style={{ borderTop: '1px solid #e5e7eb' }}>
                    <CashCell label="Starting"  value={`₱${sess.starting_cash.toFixed(2)}`} />
                    <CashCell label="Collected" value={`₱${(sess.cash_collected ?? 0).toFixed(2)}`} />
                    <CashCell label="Expected"  value={sess.expected_cash != null ? `₱${sess.expected_cash.toFixed(2)}` : '—'} />
                    <CashCell label="Actual"    value={sess.actual_cash   != null ? `₱${sess.actual_cash.toFixed(2)}`   : '—'} />
                  </div>
                  {diff !== null && (
                    <div className="flex items-center justify-between px-4 py-2 text-sm" style={{ borderTop: '1px solid #e5e7eb', background: isOver ? '#eff6ff' : isShort ? '#fef2f2' : '#f0fdf4' }}>
                      <span className="font-semibold" style={{ color: '#374151' }}>{isOver ? 'Over' : isShort ? 'Short' : 'Exact'}</span>
                      <span className="font-extrabold" style={{ color: isOver ? '#2563eb' : isShort ? '#dc2626' : '#15803d' }}>
                        {isExact ? '₱0.00' : `${diff > 0 ? '+' : ''}₱${diff.toFixed(2)}`}
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

// ─── SessionsPanel ────────────────────────────────────────────────────────────

export default function SessionsPanel() {
  const [selected, setSelected] = useState<CashSession | null>(null)
  return selected
    ? <SessionDetail session={selected} onBack={() => setSelected(null)} />
    : <SessionList onSelect={setSelected} />
}
