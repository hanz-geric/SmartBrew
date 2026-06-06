import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'

export default function Dashboard() {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            Dashboard
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {user?.full_name} · {user?.role}
            </span>
            <Button variant="outline" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Stats coming in issue #4.
        </p>
      </div>
    </div>
  )
}
