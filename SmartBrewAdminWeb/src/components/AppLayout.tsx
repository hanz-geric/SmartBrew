import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

interface NavItem {
  path:         string
  label:        string
  icon:         string
  adminOnly?:   boolean
  managerOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard',  icon: '📊' },
  { path: '/orders',    label: 'Orders',     icon: '🧾' },
  { path: '/sessions',  label: 'Sessions',   icon: '💰' },
  { path: '/products',  label: 'Menu',       icon: '🍽️', adminOnly: true },
  { path: '/categories',label: 'Categories', icon: '🏷️', managerOnly: true },
  { path: '/modifiers', label: 'Modifiers',  icon: '🎛️', adminOnly: true },
  { path: '/stock',     label: 'Stock',      icon: '📦' },
  { path: '/users',     label: 'Users',      icon: '👥', adminOnly: true },
  { path: '/settings',  label: 'Settings',   icon: '⚙️', adminOnly: true },
]

interface Props {
  children: React.ReactNode
}

export default function AppLayout({ children }: Props) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 768)

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.adminOnly   && user?.role !== 'admin')   return false
    if (item.managerOnly && user?.role !== 'manager') return false
    return true
  })

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ── */}
      <aside
        className="flex flex-col shrink-0 overflow-hidden transition-all duration-200"
        style={{
          width:      collapsed ? 56 : 220,
          background: '#166534',
        }}
      >
        {/* Brand + toggle button */}
        <div
          className="flex items-center gap-2 px-2 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}
        >
          {!collapsed && (
            <div className="flex-1 min-w-0 pl-1">
              <span className="text-white font-bold text-sm block truncate">SmartBrew</span>
              <span
                className="text-xs font-medium uppercase tracking-widest block truncate"
                style={{ color: '#bbf7d0', letterSpacing: '0.08em' }}
              >
                {user?.role}
              </span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md transition-colors"
            style={{ color: '#bbf7d0' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <span className="text-base">{collapsed ? '☰' : '✕'}</span>
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-2">
          {visibleItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 mx-1.5 my-0.5 rounded-lg text-sm font-medium transition-colors',
                  collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5',
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-green-200 hover:bg-white/10 hover:text-white',
                ].join(' ')
              }
              title={collapsed ? item.label : undefined}
            >
              <span className="text-base shrink-0">{item.icon}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div
          className="px-2 py-4 flex flex-col gap-1"
          style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}
        >
          {!collapsed && (
            <>
              <span className="text-white text-xs font-semibold truncate px-1">{user?.full_name}</span>
              <span className="text-xs truncate px-1" style={{ color: '#bbf7d0' }}>@{user?.username}</span>
            </>
          )}
          <button
            onClick={handleLogout}
            className="mt-1 w-full py-1.5 rounded-md text-xs font-medium text-white transition-colors hover:bg-white/20"
            style={{ background: 'rgba(255,255,255,0.1)' }}
            title={collapsed ? 'Log out' : undefined}
          >
            {collapsed ? '⏻' : 'Log out'}
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto bg-[#f9fafb]">
        {children}
      </main>
    </div>
  )
}
