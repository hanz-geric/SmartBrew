import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import ProtectedRoute from '@/components/ProtectedRoute'

const Login        = lazy(() => import('@/screens/Login'))
const Dashboard     = lazy(() => import('@/screens/Dashboard'))
const Products      = lazy(() => import('@/screens/Products'))
const Stock         = lazy(() => import('@/screens/Stock'))
const Users         = lazy(() => import('@/screens/Users'))
const SettingsPage  = lazy(() => import('@/screens/Settings'))
const Reports       = lazy(() => import('@/screens/Reports'))

function Protected({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>
}

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Loading…</p>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login"      element={<Login />} />
            <Route path="/dashboard"  element={<Protected><Dashboard /></Protected>} />
            <Route path="/orders"     element={<Navigate to="/reports" replace />} />
            <Route path="/products"   element={<Protected><Products /></Protected>} />
            <Route path="/categories" element={<Protected><Products /></Protected>} />
            <Route path="/modifiers"  element={<Navigate to="/products" replace />} />
            <Route path="/stock"      element={<Protected><Stock /></Protected>} />
            <Route path="/users"      element={<Protected><Users /></Protected>} />
            <Route path="/settings"   element={<Protected><SettingsPage /></Protected>} />
            <Route path="/reports"    element={<Protected><Reports /></Protected>} />
            <Route path="*"           element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
