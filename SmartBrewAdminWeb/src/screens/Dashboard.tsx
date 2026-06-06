import { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '@/firebase/config'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import AppLayout from '@/components/AppLayout'

interface Stats {
  ordersToday:    number
  revenueToday:   number
  openSessions:   number
  closedToday:    number
}

function todayStart(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
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

  const tiles = [
    { label: 'Orders today',      value: stats.ordersToday,                        icon: '🧾' },
    { label: 'Revenue today',     value: `₱${stats.revenueToday.toLocaleString()}`, icon: '💵' },
    { label: 'Open sessions',     value: stats.openSessions,                        icon: '🔓' },
    { label: 'Sessions closed today', value: stats.closedToday,                    icon: '✅' },
  ]

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-lg font-semibold mb-6" style={{ color: 'var(--color-text)' }}>
          Dashboard
        </h1>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile) => (
            <Card
              key={tile.label}
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            >
              <CardHeader className="pb-1">
                <CardTitle className="text-xs font-medium flex items-center gap-2"
                  style={{ color: 'var(--color-text-muted)' }}>
                  <span>{tile.icon}</span>
                  {tile.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
                  {tile.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(['Top products', 'Sales by hour'] as const).map((label) => (
            <Card
              key={label}
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            >
              <CardHeader>
                <CardTitle className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  {label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                  Coming soon
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  )
}
