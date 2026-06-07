import { useEffect, useState } from 'react'
import { query, where, orderBy, getDocs } from 'firebase/firestore'
import { ordersCol } from '@/firebase/collections'
import AppLayout from '@/components/AppLayout'
import type { Order } from '@/types'

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
    case 'month':
      return {
        start: new Date(today.getFullYear(), today.getMonth(), 1).toISOString(),
        end:   now.toISOString(),
      }
  }
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  })
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function VoidLog() {
  const [period,  setPeriod]  = useState<Period>('today')
  const [rev,     setRev]     = useState(0)
  const [orders,  setOrders]  = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const { start, end } = getRange(period)
        const snap = await getDocs(
          query(
            ordersCol(),
            where('status',     '==', 'cancelled'),
            where('created_at', '>=', start),
            where('created_at', '<=', end),
            orderBy('created_at', 'desc'),
          ),
        )
        if (!cancelled) {
          setOrders(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Order, 'id'>) })))
        }
      } catch (e: unknown) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [period, rev])

  const totalVoided = orders.reduce((sum, o) => sum + o.total_amount, 0)

  return (
    <AppLayout>
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 bg-white" style={{ borderBottom: '1px solid #e5e7eb' }}>
        <div className="flex items-center gap-3 px-6 py-3">
          <h1 className="text-xl font-bold shrink-0" style={{ color: '#111827' }}>Void Log</h1>
          <div className="flex-1" />
          <button
            onClick={() => setRev(r => r + 1)}
            disabled={loading}
            className="px-3 py-1 rounded-md text-sm font-semibold disabled:opacity-50"
            style={{ border: '1px solid #e5e7eb', color: '#15803d' }}
          >
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-3 px-6 py-2.5" style={{ borderTop: '1px solid #f3f4f6' }}>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold" style={{ color: '#9ca3af' }}>PERIOD</span>
            <select
              value={period}
              onChange={e => setPeriod(e.target.value as Period)}
              className="text-sm font-semibold rounded-md px-2 py-1 outline-none cursor-pointer"
              style={{ border: '1px solid #e5e7eb', color: '#374151', background: '#ffffff' }}
            >
              {PERIODS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Summary bar */}
        {!loading && !error && orders.length > 0 && (
          <div
            className="flex items-center justify-between px-6 py-2"
            style={{ background: '#fef2f2', borderTop: '1px solid rgba(220,38,38,0.2)' }}
          >
            <span className="text-sm font-medium" style={{ color: '#dc2626' }}>
              {orders.length} voided order{orders.length !== 1 ? 's' : ''}
            </span>
            <span className="text-sm font-bold" style={{ color: '#dc2626' }}>
              ₱{totalVoided.toLocaleString('en-PH', { minimumFractionDigits: 2 })} voided
            </span>
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="p-4 max-w-4xl mx-auto">
        {loading && (
          <div className="flex justify-center py-16">
            <span className="text-sm" style={{ color: '#9ca3af' }}>Loading…</span>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg px-4 py-3 text-sm mt-4" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
            {error}
          </div>
        )}

        {!loading && !error && orders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <span className="text-3xl">✅</span>
            <p className="text-sm font-medium" style={{ color: '#6b7280' }}>No voided orders for this period</p>
          </div>
        )}

        {!loading && !error && orders.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {orders.map(order => (
              <div
                key={order.id}
                className="bg-white rounded-lg px-4 py-3"
                style={{ border: '1px solid #fecaca' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold" style={{ color: '#111827' }}>
                        #{order.order_number}
                      </span>
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: '#fee2e2', color: '#b91c1c' }}
                      >
                        Voided
                      </span>
                      <span className="text-xs" style={{ color: '#9ca3af' }}>
                        {TYPE_LABELS[order.order_type] ?? order.order_type}
                      </span>
                      <span className="text-xs" style={{ color: '#9ca3af' }}>
                        {PAY_LABELS[order.payment_method] ?? order.payment_method}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 flex-wrap">
                      {order.cashier_name && (
                        <span className="text-xs" style={{ color: '#6b7280' }}>
                          Cashier: <span className="font-medium">{order.cashier_name}</span>
                        </span>
                      )}
                      <span className="text-xs" style={{ color: '#6b7280' }}>
                        {fmtDateTime(order.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold" style={{ color: '#dc2626' }}>
                      ₱{order.total_amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs" style={{ color: '#9ca3af' }}>
                      {order.items?.length ?? 0} item{(order.items?.length ?? 0) !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
