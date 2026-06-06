import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loginWithUsername, logout } from '@/firebase/auth'
import { useAuth } from '@/context/AuthContext'

export default function Login() {
  const { user } = useAuth()
  const navigate  = useNavigate()

  const [username, setUsername] = useState('')
  const [pin, setPin]           = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

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
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#166534' }}>
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm p-8" style={{ border: '1px solid #e5e7eb' }}>

        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold" style={{ color: '#111827' }}>SmartBrew Admin</h1>
          <p className="mt-1 text-sm" style={{ color: '#6b7280' }}>Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>
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
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
              style={{ background: '#fff', border: '1px solid #d1d5db', color: '#111827' }}
            />
          </div>

          <div>
            <label htmlFor="pin" className="block text-sm font-medium mb-1" style={{ color: '#374151' }}>
              PIN
            </label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={e => setPin(e.target.value)}
              required
              className="w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
              style={{ background: '#fff', border: '1px solid #d1d5db', color: '#111827' }}
            />
          </div>

          {error && (
            <div className="rounded-lg px-3 py-2 text-sm" style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{ background: loading ? '#15803d' : '#166534' }}
            onMouseEnter={e => { if (!loading) (e.target as HTMLButtonElement).style.background = '#15803d' }}
            onMouseLeave={e => { if (!loading) (e.target as HTMLButtonElement).style.background = '#166534' }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
