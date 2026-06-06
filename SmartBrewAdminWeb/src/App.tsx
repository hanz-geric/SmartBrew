import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import ProtectedRoute from '@/components/ProtectedRoute'
import AppLayout from '@/components/AppLayout'
import Login from '@/screens/Login'
import Dashboard from '@/screens/Dashboard'

function Soon({ label }: { label: string }) {
  return (
    <AppLayout>
      <div className="p-8">
        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {label} — coming soon
        </p>
      </div>
    </AppLayout>
  )
}

function Protected({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login"      element={<Login />} />
          <Route path="/dashboard"  element={<Protected><Dashboard /></Protected>} />
          <Route path="/orders"     element={<Protected><Soon label="Orders" /></Protected>} />
          <Route path="/sessions"   element={<Protected><Soon label="Sessions" /></Protected>} />
          <Route path="/products"   element={<Protected><Soon label="Menu" /></Protected>} />
          <Route path="/categories" element={<Protected><Soon label="Categories" /></Protected>} />
          <Route path="/modifiers"  element={<Protected><Soon label="Modifiers" /></Protected>} />
          <Route path="/stock"      element={<Protected><Soon label="Stock" /></Protected>} />
          <Route path="/users"      element={<Protected><Soon label="Users" /></Protected>} />
          <Route path="/settings"   element={<Protected><Soon label="Settings" /></Protected>} />
          <Route path="*"           element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
