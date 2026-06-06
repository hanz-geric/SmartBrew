import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loginWithUsername, logout } from '@/firebase/auth'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'

export default function Login() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [pin, setPin]           = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  // Already logged in — send to dashboard
  if (user) {
    navigate('/dashboard', { replace: true })
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const authUser = await loginWithUsername(username, pin)
      if (authUser.role === 'cashier') {
        setError('Access denied. This app is for admins and managers only.')
        await logout()
        return
      }
      navigate('/dashboard', { replace: true })
    } catch (err: unknown) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>
            SmartBrew Admin
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            Sign in to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2"
              style={{
                background: 'var(--color-surface)',
                border:     '1px solid var(--color-border)',
                color:      'var(--color-text)',
              }}
            />
          </div>

          <div>
            <label
              htmlFor="pin"
              className="block text-sm font-medium mb-1"
              style={{ color: 'var(--color-text-muted)' }}
            >
              PIN
            </label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={e => setPin(e.target.value)}
              required
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2"
              style={{
                background: 'var(--color-surface)',
                border:     '1px solid var(--color-border)',
                color:      'var(--color-text)',
              }}
            />
          </div>

          {error && (
            <p className="text-sm text-center" style={{ color: 'var(--color-danger)' }}>
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  )
}
