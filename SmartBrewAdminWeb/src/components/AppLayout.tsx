import { useState, useEffect } from 'react'
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
  { path: '/reports',   label: 'Reports',    icon: '📈' },
  { path: '/products',  label: 'Menu',       icon: '🍽️', adminOnly: true },
  { path: '/categories',label: 'Categories', icon: '🏷️', managerOnly: true },
  { path: '/stock',     label: 'Stock',      icon: '📦' },
  { path: '/users',     label: 'Users',      icon: '👥', adminOnly: true },
  { path: '/settings',  label: 'Settings',   icon: '⚙️', adminOnly: true },
]

const DESKTOP_BP = 1024

interface Props {
  children: React.ReactNode
}

export default function AppLayout({ children }: Props) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= DESKTOP_BP)
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < DESKTOP_BP)

  useEffect(() => {
    function onResize() {
      const desktop = window.innerWidth >= DESKTOP_BP
      setIsDesktop(desktop)
      if (desktop) setCollapsed(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.adminOnly   && user?.role !== 'admin')   return false
    if (item.managerOnly && user?.role !== 'manager') return false
    return true
  })

  const sidebarContent = (
    <>
      {/* Brand + collapse button (mobile only) */}
      <div
        className="flex items-center gap-2 px-3 py-4 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', minWidth: 220 }}
      >
        <div className="flex-1 min-w-0">
          <span className="text-white font-bold text-sm block truncate">SmartBrew</span>
          <span
            className="text-xs font-medium uppercase tracking-widest block truncate"
            style={{ color: '#bbf7d0', letterSpacing: '0.08em' }}
          >
            {user?.role}
          </span>
        </div>
        {!isDesktop && (
          <button
            onClick={() => setCollapsed(true)}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md font-bold text-sm transition-colors"
            style={{ color: '#bbf7d0' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            title="Collapse sidebar"
          >
            ‹‹
          </button>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto py-2" style={{ minWidth: 220 }}>
        {visibleItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={() => { if (!isDesktop) setCollapsed(true) }}
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
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div
        className="px-3 py-4 flex flex-col gap-1 shrink-0"
        style={{ borderTop: '1px solid rgba(255,255,255,0.1)', minWidth: 220 }}
      >
        <span className="text-white text-xs font-semibold truncate">{user?.full_name}</span>
        <span className="text-xs truncate" style={{ color: '#bbf7d0' }}>@{user?.username}</span>
        <button
          onClick={handleLogout}
          className="mt-2 w-full py-1.5 rounded-md text-xs font-medium text-white transition-colors hover:bg-white/20"
          style={{ background: 'rgba(255,255,255,0.1)' }}
        >
          Log out
        </button>
      </div>
    </>
  )

  /* ── Desktop layout: sidebar always visible, pushes content ── */
  if (isDesktop) {
    return (
      <div className="flex h-screen overflow-hidden">
        <aside
          className="flex flex-col h-full shrink-0 overflow-hidden"
          style={{
            width:      220,
            background: 'rgba(22, 101, 52, 0.92)',
          }}
        >
          {sidebarContent}
        </aside>
        <main className="flex-1 h-full overflow-y-auto bg-[#f9fafb]">
          {children}
        </main>
      </div>
    )
  }

  /* ── Mobile/tablet layout: slide-over overlay ── */
  return (
    <div className="flex h-screen overflow-hidden">

      {/* Reopen tab */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="fixed left-0 top-1/2 -translate-y-1/2 z-50 flex items-center justify-center w-7 h-9 rounded-r-lg text-sm font-bold text-white shadow-md transition-colors hover:opacity-90"
          style={{ background: '#166534' }}
          title="Open sidebar"
        >
          ›
        </button>
      )}

      {/* Backdrop scrim */}
      {!collapsed && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setCollapsed(true)}
        />
      )}

      {/* Sidebar overlay */}
      <aside
        className="fixed left-0 top-0 h-full flex flex-col z-50 overflow-hidden"
        style={{
          width:      220,
          transform:  collapsed ? 'translateX(-100%)' : 'translateX(0)',
          transition: 'transform 200ms ease',
          background: 'rgba(22, 101, 52, 0.92)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      >
        {sidebarContent}
      </aside>

      {/* Main content */}
      <main className="w-full h-full overflow-y-auto bg-[#f9fafb]">
        {children}
      </main>

    </div>
  )
}
