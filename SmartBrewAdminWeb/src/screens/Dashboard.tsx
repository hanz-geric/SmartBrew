import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/firebase/config'
import AppLayout from '@/components/AppLayout'

interface Stats {
  ordersToday:  number
  revenueToday: number
  openSessions: number
  closedToday:  number
}

function todayStart(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

interface StatCardProps {
  label:  string
  value:  string | number
  accent: string
}

function StatCard({ label, value, accent }: StatCardProps) {
  return (
    <div
      className="bg-white rounded-lg p-4 shadow-sm"
      style={{ borderTop: `3px solid ${accent}`, border: '1px solid #e5e7eb', borderTopColor: accent }}
    >
      <p className="text-xs font-medium" style={{ color: '#6b7280' }}>{label}</p>
      <p className="text-2xl font-extrabold mt-1" style={{ color: accent }}>{value}</p>
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats>({
    ordersToday: 0, revenueToday: 0, openSessions: 0, closedToday: 0,
  })

  useEffect(() => {
    const start = todayStart()

    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), where('created_at', '>=', start)),
      (snap) => {
        let revenue = 0
        snap.forEach((doc) => {
          const d = doc.data()
          if (d.status === 'completed') revenue += d.total_amount ?? 0
        })
        setStats((prev) => ({ ...prev, ordersToday: snap.size, revenueToday: revenue }))
      },
    )

    const unsubOpen = onSnapshot(
      query(collection(db, 'cash_sessions'), where('status', '==', 'open')),
      (snap) => setStats((prev) => ({ ...prev, openSessions: snap.size })),
    )

    const unsubClosed = onSnapshot(
      query(collection(db, 'cash_sessions'), where('status', '==', 'closed'), where('end_time', '>=', start)),
      (snap) => setStats((prev) => ({ ...prev, closedToday: snap.size })),
    )

    return () => { unsubOrders(); unsubOpen(); unsubClosed() }
  }, [])

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-xl font-bold mb-6" style={{ color: '#111827' }}>Dashboard</h1>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Orders today"         value={stats.ordersToday}                         accent="#15803d" />
          <StatCard label="Revenue today"        value={`₱${stats.revenueToday.toLocaleString()}`} accent="#2563eb" />
          <StatCard label="Open sessions"        value={stats.openSessions}                        accent="#d97706" />
          <StatCard label="Sessions closed today" value={stats.closedToday}                        accent="#6b7280" />
        </div>

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(['Top products', 'Sales by hour'] as const).map((label) => (
            <div
              key={label}
              className="bg-white rounded-lg p-4 shadow-sm"
              style={{ border: '1px solid #e5e7eb' }}
            >
              <p className="text-sm font-semibold mb-3" style={{ color: '#374151' }}>{label}</p>
              <p className="text-xs" style={{ color: '#9ca3af' }}>Coming soon</p>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  )
}
