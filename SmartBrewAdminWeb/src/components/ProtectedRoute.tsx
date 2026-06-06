import { Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useIdleTimeout } from '@/hooks/useIdleTimeout'
import { useCallback } from 'react'

const IDLE_TIMEOUT_MS = 60 * 60 * 1000 // 60 minutes

interface Props {
  children: React.ReactNode
}

export default function ProtectedRoute({ children }: Props) {
  const { user, loading, logout } = useAuth()

  const handleIdle = useCallback(() => { logout() }, [logout])
  useIdleTimeout(handleIdle, IDLE_TIMEOUT_MS)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  if (user.role === 'cashier') return <Navigate to="/login" replace />

  return <>{children}</>
}
