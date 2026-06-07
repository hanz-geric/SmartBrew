import { useEffect, useState } from 'react'
import { query, where, getDocs } from 'firebase/firestore'
import { ordersCol } from '@/firebase/collections'
import { useAuth } from '@/context/AuthContext'
import AppLayout from '@/components/AppLayout'
import type { Order } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type Granularity = 'daily' | 'weekly' | 'monthly'

interface Bucket {
  label:   string
  revenue: number
  profit:  number
  count:   number
}

interface TopProduct {
  name: string
  qty:  number
}

interface PayBreakdown {
  method:  string
  label:   string
  revenue: number
  count:   number
}

interface HourBucket {
  hour:  number
  label: string
  count: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: 'daily',   label: 'Daily (30d)'   },
  { value: 'weekly',  label: 'Weekly (12w)'  },
  { value: 'monthly', label: 'Monthly (12m)' },
]

const PAY_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', qr: 'QR', gift_card: 'Gift Card', pay_later: 'Pay Later',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rangeStart(g: Granularity): string {
  const d = new Date()
  if (g === 'daily')   { d.setDate(d.getDate() - 29);  d.setHours(0, 0, 0, 0) }
  if (g === 'weekly')  { d.setDate(d.getDate() - 83);  d.setHours(0, 0, 0, 0) }
  if (g === 'monthly') { d.setMonth(d.getMonth() - 11); d.setDate(1); d.setHours(0, 0, 0, 0) }
  return d.toISOString()
}

function buildBuckets(orders: Order[], g: Granularity): Bucket[] {
  const now = new Date()

  if (g === 'daily') {
    const buckets: (Bucket & { date: Date })[] = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0)
      buckets.push({ date: d, label: d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }), revenue: 0, profit: 0, count: 0 })
    }
    for (const o of orders) {
      const t = new Date(o.created_at).getTime()
      for (const b of buckets) {
        const next = new Date(b.date); next.setDate(next.getDate() + 1)
        if (t >= b.date.getTime() && t < next.getTime()) { b.revenue += o.total_amount; b.profit += o.profit_amount ?? 0; b.count++; break }
      }
    }
    return buckets
  }

  if (g === 'weekly') {
    const buckets: (Bucket & { weekStart: Date })[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i * 7); d.setHours(0, 0, 0, 0)
      // snap to Monday of that week
      const day = d.getDay(); const diff = (day === 0 ? -6 : 1 - day)
      d.setDate(d.getDate() + diff)
      const label = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
      if (!buckets.find(b => b.weekStart.getTime() === d.getTime()))
        buckets.push({ weekStart: new Date(d), label, revenue: 0, profit: 0, count: 0 })
    }
    for (const o of orders) {
      const t = new Date(o.created_at).getTime()
      for (let i = 0; i < buckets.length; i++) {
        const nextWeek = i + 1 < buckets.length ? buckets[i + 1].weekStart.getTime() : Infinity
        if (t >= buckets[i].weekStart.getTime() && t < nextWeek) {
          buckets[i].revenue += o.total_amount; buckets[i].profit += o.profit_amount ?? 0; buckets[i].count++; break
        }
      }
    }
    return buckets
  }

  // monthly
  const buckets: (Bucket & { month: Date })[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    buckets.push({ month: d, label: d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit' }), revenue: 0, profit: 0, count: 0 })
  }
  for (const o of orders) {
    const t = new Date(o.created_at)
    for (const b of buckets) {
      if (t.getFullYear() === b.month.getFullYear() && t.getMonth() === b.month.getMonth()) {
        b.revenue += o.total_amount; b.profit += o.profit_amount ?? 0; b.count++; break
      }
    }
  }
  return buckets
}

function buildTopProducts(orders: Order[]): TopProduct[] {
  const map: Record<string, number> = {}
  for (const o of orders)
    for (const item of o.items ?? [])
      map[item.product_name] = (map[item.product_name] ?? 0) + item.quantity
  return Object.entries(map).map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty).slice(0, 10)
}

function buildPayBreakdown(orders: Order[]): PayBreakdown[] {
  const map: Record<string, { revenue: number; count: number }> = {}
  for (const o of orders) {
    const m = o.payment_method
    if (!map[m]) map[m] = { revenue: 0, count: 0 }
    map[m].revenue += o.total_amount
    map[m].count++
  }
  return Object.entries(map)
    .map(([method, d]) => ({ method, label: PAY_LABELS[method] ?? method, ...d }))
    .sort((a, b) => b.revenue - a.revenue)
}

function buildPeakHours(orders: Order[]): HourBucket[] {
  const counts = Array(24).fill(0)
  for (const o of orders) counts[new Date(o.created_at).getHours()]++
  return counts.map((count, hour) => {
    const h = hour % 12 || 12
    const ampm = hour < 12 ? 'am' : 'pm'
    return { hour, label: `${h}${ampm}`, count }
  })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RevenueChart({ buckets, showProfit, granularity }: { buckets: Bucket[]; showProfit: boolean; granularity: Granularity }) {
  const max         = Math.max(...buckets.map(b => b.revenue), 1)
  const hasData     = buckets.some(b => b.revenue > 0)
  const totalRev    = buckets.reduce((s, b) => s + b.revenue, 0)
  const totalProfit = buckets.reduce((s, b) => s + b.profit,  0)
  const totalCount  = buckets.reduce((s, b) => s + b.count,   0)
  const avgOrder    = totalCount > 0 ? totalRev / totalCount : 0

  // for daily (30 bars) only show a label every 5 days; weekly/monthly show all
  const labelStep = granularity === 'daily' ? 5 : 1

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm" style={{ border: '1px solid #e5e7eb' }}>
      <p className="text-sm font-semibold mb-4" style={{ color: '#374151' }}>Revenue</p>
      <div className="flex items-end gap-1 h-36">
        {buckets.map((b, i) => (
          <div key={i} className="flex-1 min-w-[4px] flex flex-col items-center gap-0">
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t-sm transition-all"
                style={{
                  height:     b.revenue > 0 ? `${Math.max((b.revenue / max) * 100, 4)}%` : '2px',
                  background: b.revenue > 0 ? '#15803d' : '#f3f4f6',
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1.5">
        {buckets.map((b, i) => (
          <div key={i} className="flex-1 text-center">
            <span style={{ color: '#9ca3af', fontSize: '9px' }}>
              {i % labelStep === 0 || i === buckets.length - 1 ? b.label : ''}
            </span>
          </div>
        ))}
      </div>
      {!hasData && (
        <p className="text-xs text-center mt-2" style={{ color: '#9ca3af' }}>No data for this period</p>
      )}
      {hasData && (
        <div className="mt-3 pt-3 flex flex-wrap items-center gap-x-6 gap-y-2" style={{ borderTop: '1px solid #f3f4f6' }}>
          <div>
            <p className="text-xs" style={{ color: '#9ca3af' }}>Total Revenue</p>
            <p className="text-sm font-bold" style={{ color: '#15803d' }}>
              ₱{totalRev.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </p>
          </div>
          {showProfit && (
            <div>
              <p className="text-xs" style={{ color: '#9ca3af' }}>Total Profit</p>
              <p className="text-sm font-bold" style={{ color: '#2563eb' }}>
                ₱{totalProfit.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs" style={{ color: '#9ca3af' }}>Orders</p>
            <p className="text-sm font-bold" style={{ color: '#374151' }}>{totalCount.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs" style={{ color: '#9ca3af' }}>Avg Order Value</p>
            <p className="text-sm font-bold" style={{ color: '#374151' }}>
              ₱{avgOrder.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function TopProductsTable({ products }: { products: TopProduct[] }) {
  const maxQty = Math.max(...products.map(p => p.qty), 1)
  return (
    <div className="bg-white rounded-lg p-4 shadow-sm" style={{ border: '1px solid #e5e7eb' }}>
      <p className="text-sm font-semibold mb-3" style={{ color: '#374151' }}>Top Products</p>
      {products.length === 0 ? (
        <p className="text-xs" style={{ color: '#9ca3af' }}>No sales data</p>
      ) : (
        <div className="flex flex-col gap-3">
          {products.map((p, i) => (
            <div key={p.name} className="flex items-center gap-2">
              <span className="text-xs font-bold w-5 shrink-0 text-right" style={{ color: '#d1d5db' }}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium truncate" style={{ color: '#111827' }}>{p.name}</span>
                  <span className="text-xs font-bold ml-2 shrink-0" style={{ color: '#15803d' }}>×{p.qty}</span>
                </div>
                <div className="h-1.5 rounded-full" style={{ background: '#f3f4f6' }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(p.qty / maxQty) * 100}%`, background: i === 0 ? '#15803d' : i < 3 ? '#22c55e' : '#86efac' }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PayBreakdownChart({ breakdown }: { breakdown: PayBreakdown[] }) {
  const maxRevenue = Math.max(...breakdown.map(b => b.revenue), 1)
  const totalRevenue = breakdown.reduce((s, b) => s + b.revenue, 0)
  return (
    <div className="bg-white rounded-lg p-4 shadow-sm" style={{ border: '1px solid #e5e7eb' }}>
      <p className="text-sm font-semibold mb-3" style={{ color: '#374151' }}>Payment Breakdown</p>
      {breakdown.length === 0 ? (
        <p className="text-xs" style={{ color: '#9ca3af' }}>No data</p>
      ) : (
        <div className="flex flex-col gap-3">
          {breakdown.map(b => (
            <div key={b.method}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium" style={{ color: '#111827' }}>{b.label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs" style={{ color: '#6b7280' }}>{b.count} orders</span>
                  <span className="text-xs font-bold" style={{ color: '#15803d' }}>
                    ₱{b.revenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-xs w-9 text-right" style={{ color: '#9ca3af' }}>
                    {totalRevenue > 0 ? `${((b.revenue / totalRevenue) * 100).toFixed(0)}%` : '—'}
                  </span>
                </div>
              </div>
              <div className="h-2 rounded-full" style={{ background: '#f3f4f6' }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(b.revenue / maxRevenue) * 100}%`, background: '#15803d' }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PeakHoursChart({ hours }: { hours: HourBucket[] }) {
  const max     = Math.max(...hours.map(h => h.count), 1)
  const hasData = hours.some(h => h.count > 0)
  // show label only at midnight, 6am, 12pm, 6pm
  const showLabel = (h: number) => h % 6 === 0

  return (
    <div className="bg-white rounded-lg p-4 shadow-sm" style={{ border: '1px solid #e5e7eb' }}>
      <p className="text-sm font-semibold mb-4" style={{ color: '#374151' }}>Peak Hours</p>
      <div className="flex items-end gap-0.5 h-24">
        {hours.map(h => (
          <div key={h.hour} className="flex-1 flex flex-col items-center gap-0">
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t-sm transition-all"
                style={{
                  height:     h.count > 0 ? `${Math.max((h.count / max) * 100, 4)}%` : '2px',
                  background: h.count > 0 ? '#15803d' : '#f3f4f6',
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-0.5 mt-1.5">
        {hours.map(h => (
          <div key={h.hour} className="flex-1 text-center">
            <span style={{ color: '#9ca3af', fontSize: '9px' }}>
              {showLabel(h.hour) ? h.label : ''}
            </span>
          </div>
        ))}
      </div>
      {!hasData && (
        <p className="text-xs text-center mt-2" style={{ color: '#9ca3af' }}>No data for this period</p>
      )}
    </div>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function Reports() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [granularity,  setGranularity]  = useState<Granularity>('daily')
  const [buckets,      setBuckets]      = useState<Bucket[]>([])
  const [topProducts,  setTopProducts]  = useState<TopProduct[]>([])
  const [payBreakdown, setPayBreakdown] = useState<PayBreakdown[]>([])
  const [peakHours,    setPeakHours]    = useState<HourBucket[]>([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const start = rangeStart(granularity)
        const snap  = await getDocs(
          query(ordersCol(), where('status', '==', 'completed'), where('created_at', '>=', start)),
        )
        if (cancelled) return
        const orders = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Order, 'id'>) }))
        setBuckets(buildBuckets(orders, granularity))
        setTopProducts(buildTopProducts(orders))
        setPayBreakdown(buildPayBreakdown(orders))
        setPeakHours(buildPeakHours(orders))
      } catch (e: unknown) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [granularity])

  return (
    <AppLayout>
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 bg-white" style={{ borderBottom: '1px solid #e5e7eb' }}>
        <div className="flex items-center gap-3 px-6 py-3">
          <h1 className="text-xl font-bold shrink-0" style={{ color: '#111827' }}>Reports</h1>
          <div className="flex-1" />
        </div>
        <div className="flex items-center gap-3 px-6 py-2.5" style={{ borderTop: '1px solid #f3f4f6' }}>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold" style={{ color: '#9ca3af' }}>RANGE</span>
            <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid #e5e7eb' }}>
              {GRANULARITIES.map(g => (
                <button
                  key={g.value}
                  onClick={() => setGranularity(g.value)}
                  className="px-3 py-1 text-sm font-semibold transition-colors"
                  style={{
                    background: granularity === g.value ? '#166534' : '#ffffff',
                    color:      granularity === g.value ? '#ffffff'  : '#374151',
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="p-4 max-w-5xl mx-auto">
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

        {!loading && !error && (
          <div className="mt-2 flex flex-col gap-4">
            <RevenueChart buckets={buckets} showProfit={isAdmin} granularity={granularity} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <TopProductsTable products={topProducts} />
              <PayBreakdownChart breakdown={payBreakdown} />
            </div>
            <PeakHoursChart hours={peakHours} />
          </div>
        )}
      </div>
    </AppLayout>
  )
}
