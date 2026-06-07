import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where, getDocs } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '@/firebase/config'
import { ordersCol, stockCol } from '@/firebase/collections'
import AppLayout from '@/components/AppLayout'
import type { Order } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  ordersToday:  number
  revenueToday: number
  openSessions: number
  closedToday:  number
}

interface DayBucket {
  label:   string
  revenue: number
  isToday: boolean
}

interface TopProduct {
  name:    string
  qty:     number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStart(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString()
}

function weekStart(): string {
  const d = new Date(); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0); return d.toISOString()
}

function buildDayBuckets(orders: Order[]): DayBucket[] {
  const buckets: (DayBucket & { date: Date })[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0)
    buckets.push({ date: d, label: d.toLocaleDateString('en-PH', { weekday: 'short' }), revenue: 0, isToday: i === 0 })
  }
  for (const order of orders) {
    const t = new Date(order.created_at).getTime()
    for (const b of buckets) {
      const next = new Date(b.date); next.setDate(next.getDate() + 1)
      if (t >= b.date.getTime() && t < next.getTime()) { b.revenue += order.total_amount; break }
    }
  }
  return buckets
}

function buildTopProducts(orders: Order[]): TopProduct[] {
  const map: Record<string, number> = {}
  for (const order of orders)
    for (const item of order.items ?? [])
      map[item.product_name] = (map[item.product_name] ?? 0) + item.quantity
  return Object.entries(map)
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return (
    <div className="bg-white rounded-lg p-4 shadow-sm" style={{ border: '1px solid #e5e7eb', borderTop: `3px solid ${accent}` }}>
      <p className="text-xs font-medium" style={{ color: '#6b7280' }}>{label}</p>
      <p className="text-2xl font-extrabold mt-1" style={{ color: accent }}>{value}</p>
    </div>
  )
}

function StockAlertStrip({ low, out }: { low: number; out: number }) {
  const navigate = useNavigate()
  if (low === 0 && out === 0) return null
  return (
    <div
      className="mt-4 rounded-lg px-4 py-3 flex items-center gap-3 flex-wrap cursor-pointer"
      style={{ background: '#fef2f2', border: '1px solid rgba(220,38,38,0.2)' }}
      onClick={() => navigate('/stock')}
    >
      <span className="text-sm font-semibold" style={{ color: '#dc2626' }}>⚠ Stock Alerts</span>
      {out > 0 && (
        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#dc2626', color: '#fff' }}>
          {out} out of stock
        </span>
      )}
      {low > 0 && (
        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#f97316', color: '#fff' }}>
          {low} low stock
        </span>
      )}
      <span className="ml-auto text-xs font-semibold" style={{ color: '#dc2626' }}>View Stock →</span>
    </div>
  )
}

function RevenueTrendChart({ buckets }: { buckets: DayBucket[] }) {
  const max = Math.max(...buckets.map(b => b.revenue), 1)
  const hasData = buckets.some(b => b.revenue > 0)
  return (
    <div className="bg-white rounded-lg p-4 shadow-sm" style={{ border: '1px solid #e5e7eb' }}>
      <p className="text-sm font-semibold mb-4" style={{ color: '#374151' }}>Revenue — Last 7 Days</p>
      <div className="flex items-end gap-1.5 h-28">
        {buckets.map(b => (
          <div key={b.label} className="flex-1 flex flex-col items-center gap-0">
            {b.revenue > 0 && (
              <span className="text-xs font-semibold mb-1 leading-none" style={{ color: b.isToday ? '#15803d' : '#9ca3af', fontSize: '10px' }}>
                ₱{b.revenue >= 1000 ? `${(b.revenue / 1000).toFixed(1)}k` : b.revenue.toFixed(0)}
              </span>
            )}
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t-md transition-all"
                style={{
                  height:     b.revenue > 0 ? `${Math.max((b.revenue / max) * 100, 8)}%` : '3px',
                  background: b.isToday ? '#15803d' : b.revenue > 0 ? '#bbf7d0' : '#f3f4f6',
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {buckets.map(b => (
          <div key={b.label} className="flex-1 text-center">
            <span className="text-xs" style={{ color: b.isToday ? '#15803d' : '#9ca3af', fontWeight: b.isToday ? '700' : '400' }}>
              {b.label}
            </span>
          </div>
        ))}
      </div>
      {!hasData && (
        <p className="text-xs text-center mt-2" style={{ color: '#9ca3af' }}>No completed orders in the last 7 days</p>
      )}
    </div>
  )
}

function TopProductsWidget({ products }: { products: TopProduct[] }) {
  const maxQty = Math.max(...products.map(p => p.qty), 1)
  return (
    <div className="bg-white rounded-lg p-4 shadow-sm" style={{ border: '1px solid #e5e7eb' }}>
      <p className="text-sm font-semibold mb-3" style={{ color: '#374151' }}>Top Products — Last 7 Days</p>
      {products.length === 0 ? (
        <p className="text-xs" style={{ color: '#9ca3af' }}>No sales data yet</p>
      ) : (
        <div className="flex flex-col gap-3">
          {products.map((p, i) => (
            <div key={p.name} className="flex items-center gap-2">
              <span className="text-xs font-bold w-4 shrink-0 text-right" style={{ color: '#d1d5db' }}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium truncate" style={{ color: '#111827' }}>{p.name}</span>
                  <span className="text-xs font-bold ml-2 shrink-0" style={{ color: '#15803d' }}>×{p.qty}</span>
                </div>
                <div className="h-1.5 rounded-full" style={{ background: '#f3f4f6' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width:      `${(p.qty / maxQty) * 100}%`,
                      background: i === 0 ? '#15803d' : i === 1 ? '#22c55e' : '#86efac',
                    }}
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

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({ ordersToday: 0, revenueToday: 0, openSessions: 0, closedToday: 0 })
  const [buckets,  setBuckets]  = useState<DayBucket[]>([])
  const [products, setProducts] = useState<TopProduct[]>([])
  const [stockAlerts, setStockAlerts] = useState({ low: 0, out: 0 })

  // Real-time stat cards
  useEffect(() => {
    const start = todayStart()

    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), where('created_at', '>=', start)),
      snap => {
        let revenue = 0
        snap.forEach(d => { const o = d.data(); if (o.status === 'completed') revenue += o.total_amount ?? 0 })
        setStats(prev => ({ ...prev, ordersToday: snap.size, revenueToday: revenue }))
      },
    )
    const unsubOpen = onSnapshot(
      query(collection(db, 'cash_sessions'), where('status', '==', 'open')),
      snap => setStats(prev => ({ ...prev, openSessions: snap.size })),
    )
    const unsubClosed = onSnapshot(
      query(collection(db, 'cash_sessions'), where('status', '==', 'closed'), where('end_time', '>=', start)),
      snap => setStats(prev => ({ ...prev, closedToday: snap.size })),
    )
    return () => { unsubOrders(); unsubOpen(); unsubClosed() }
  }, [])

  // One-time fetches for charts + stock alerts
  useEffect(() => {
    const week = weekStart()
    Promise.all([
      getDocs(query(ordersCol(), where('created_at', '>=', week))),
      getDocs(stockCol()),
    ]).then(([ordersSnap, stockSnap]) => {
      const orders = ordersSnap.docs
        .map(d => ({ id: d.id, ...(d.data() as Omit<Order, 'id'>) }))
        .filter(o => o.status === 'completed')

      setBuckets(buildDayBuckets(orders))
      setProducts(buildTopProducts(orders))

      let low = 0, out = 0
      stockSnap.forEach(d => {
        const item = d.data()
        if (!item.is_active) return
        if (item.quantity_on_hand <= 0) out++
        else if (item.quantity_on_hand <= item.reorder_level) low++
      })
      setStockAlerts({ low, out })
    })
  }, [])

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-xl font-bold mb-6" style={{ color: '#111827' }}>Dashboard</h1>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Orders today"          value={stats.ordersToday}                                 accent="#15803d" />
          <StatCard label="Revenue today"         value={`₱${stats.revenueToday.toLocaleString('en-PH')}`} accent="#2563eb" />
          <StatCard label="Open sessions"         value={stats.openSessions}                               accent="#d97706" />
          <StatCard label="Sessions closed today" value={stats.closedToday}                                accent="#6b7280" />
        </div>

        <StockAlertStrip low={stockAlerts.low} out={stockAlerts.out} />

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {buckets.length > 0
            ? <RevenueTrendChart buckets={buckets} />
            : <div className="bg-white rounded-lg p-4 shadow-sm animate-pulse" style={{ border: '1px solid #e5e7eb', height: '180px' }} />
          }
          {products.length > 0 || buckets.length > 0
            ? <TopProductsWidget products={products} />
            : <div className="bg-white rounded-lg p-4 shadow-sm animate-pulse" style={{ border: '1px solid #e5e7eb', height: '180px' }} />
          }
        </div>
      </div>
    </AppLayout>
  )
}
