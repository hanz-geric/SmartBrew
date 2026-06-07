import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import ProtectedRoute from '@/components/ProtectedRoute'
import Login from '@/screens/Login'
import Dashboard from '@/screens/Dashboard'
import Orders from '@/screens/Orders'
import Sessions from '@/screens/Sessions'
import Products from '@/screens/Products'
import Modifiers from '@/screens/Modifiers'
import Stock from '@/screens/Stock'
import Users from '@/screens/Users'
import SettingsPage from '@/screens/Settings'

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
          <Route path="/orders"     element={<Protected><Orders /></Protected>} />
          <Route path="/sessions"   element={<Protected><Sessions /></Protected>} />
          <Route path="/products"   element={<Protected><Products /></Protected>} />
          <Route path="/categories" element={<Protected><Products /></Protected>} />
          <Route path="/modifiers"  element={<Protected><Modifiers /></Protected>} />
          <Route path="/stock"      element={<Protected><Stock /></Protected>} />
          <Route path="/users"      element={<Protected><Users /></Protected>} />
          <Route path="/settings"   element={<Protected><SettingsPage /></Protected>} />
          <Route path="*"           element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
