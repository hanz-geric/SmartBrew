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
        className="flex flex-col shrink-0 overflow-hidden"
        style={{
          width: 'clamp(56px, 18vw, 220px)',
          background: '#166534',
        }}
      >
        {/* Brand */}
        <div
          className="flex flex-col px-3 py-5 gap-1"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}
        >
          <span className="text-white font-bold text-sm truncate hidden sm:block">SmartBrew</span>
          <span
            className="text-xs font-medium uppercase tracking-widest truncate hidden sm:block"
            style={{ color: '#bbf7d0', letterSpacing: '0.08em' }}
          >
            {user?.role}
          </span>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-2">
          {visibleItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 mx-1.5 my-0.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-green-200 hover:bg-white/10 hover:text-white',
                ].join(' ')
              }
            >
              <span className="text-base shrink-0">{item.icon}</span>
              <span className="truncate hidden sm:block">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div
          className="px-3 py-4 flex flex-col gap-1"
          style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}
        >
          <span className="text-white text-xs font-semibold truncate hidden sm:block">
            {user?.full_name}
          </span>
          <span className="text-xs truncate hidden sm:block" style={{ color: '#bbf7d0' }}>
            @{user?.username}
          </span>
          <button
            onClick={handleLogout}
            className="mt-2 w-full py-1.5 rounded-md text-xs font-medium text-white transition-colors hover:bg-white/20"
            style={{ background: 'rgba(255,255,255,0.1)' }}
          >
            <span className="hidden sm:inline">Log out</span>
            <span className="sm:hidden">⏻</span>
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
