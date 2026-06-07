import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import ProtectedRoute from '@/components/ProtectedRoute'
import Login from '@/screens/Login'
import Dashboard from '@/screens/Dashboard'
import Products from '@/screens/Products'
import Stock from '@/screens/Stock'
import Users from '@/screens/Users'
import SettingsPage from '@/screens/Settings'
import Reports from '@/screens/Reports'

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
      </AuthProvider>
    </BrowserRouter>
  )
}
