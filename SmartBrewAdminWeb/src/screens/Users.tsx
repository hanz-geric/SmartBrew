import { useCallback, useEffect, useState } from 'react'
import { getDocs } from 'firebase/firestore'
import { usersCol } from '@/firebase/collections'
import {
  createUserAccount, resetUserPassword, updateUserProfile,
} from '@/firebase/auth'
import { useAuth } from '@/context/AuthContext'
import AppLayout from '@/components/AppLayout'
import type { UserProfile, UserRole } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type View = { kind: 'list' } | { kind: 'editUser'; uid: string | null }

const ROLES: UserRole[] = ['cashier', 'manager', 'admin']

const ROLE_STYLE: Record<UserRole, { bg: string; border: string; text: string }> = {
  admin:   { bg: '#fef2f2', border: '#dc2626', text: '#dc2626' },
  manager: { bg: '#eff6ff', border: '#3b82f6', text: '#1d4ed8' },
  cashier: { bg: '#f0fdf4', border: '#16a34a', text: '#15803d' },
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

async function loadUsers(): Promise<UserProfile[]> {
  const snap = await getDocs(usersCol())
  return snap.docs
    .map(d => {
      const data = d.data()
      return {
        uid:       d.id,
        username:  (data.username  as string)   ?? '',
        full_name: (data.full_name as string)   ?? '',
        role:      (data.role      as UserRole) ?? 'cashier',
        is_active: data.is_active !== false,
      } as UserProfile
    })
    .sort((a, b) => a.username.localeCompare(b.username))
}

// ─── UserEditForm ─────────────────────────────────────────────────────────────

function UserEditForm({
  users, editUid, currentUid, onBack, onSaved,
}: {
  users:      UserProfile[]
  editUid:    string | null
  currentUid: string
  onBack:     () => void
  onSaved:    () => void
}) {
  const isNew    = editUid === null
  const existing = editUid ? users.find(u => u.uid === editUid) : null
  const isSelf   = editUid === currentUid

  const [username,    setUsername]    = useState(existing?.username  ?? '')
  const [fullName,    setFullName]    = useState(existing?.full_name ?? '')
  const [password,    setPassword]    = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [role,        setRole]        = useState<UserRole>(existing?.role ?? 'cashier')
  const [isActive,    setIsActive]    = useState(existing?.is_active ?? true)

  const [saving,        setSaving]        = useState(false)
  const [toggleConfirm, setToggleConfirm] = useState(false)
  const [error,         setError]         = useState('')

  async function handleSave() {
    setError('')
    const uname = username.trim().toLowerCase()
    const fname = fullName.trim()

    if (!uname)                         { setError('Username is required.'); return }
    if (!/^[a-z0-9_]+$/.test(uname))   { setError('Username: only letters, numbers, and underscores.'); return }
    if (!fname)                         { setError('Full name is required.'); return }
    if (isNew && password.length < 6)   { setError('Password must be at least 6 characters.'); return }
    if (!isNew && newPassword.length > 0 && newPassword.length < 6) {
      setError('New password must be at least 6 characters.'); return
    }
    if (!isNew && isSelf && !isActive)  { setError('You cannot deactivate your own account.'); return }

    setSaving(true)
    try {
      if (isNew) {
        await createUserAccount(uname, password, fname, role)
      } else {
        await updateUserProfile(editUid!, { full_name: fname, role, is_active: isActive })
        if (newPassword.length >= 6) {
          await resetUserPassword(editUid!, newPassword)
        }
      }
      onSaved()
    } catch (e: unknown) {
      const code = (e as { code?: string }).code ?? ''
      if (code === 'auth/email-already-in-use') {
        setError(`Username "${uname}" is already taken.`)
      } else if (code === 'permission-denied') {
        setError('Permission denied.')
      } else {
        setError((e as Error).message || 'Failed to save. Check your connection.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <button onClick={onBack} className="text-sm font-medium mb-2 block" style={{ color: '#15803d' }}>
        ‹ Back
      </button>
      <h1 className="text-xl font-bold mb-6" style={{ color: '#111827' }}>
        {isNew ? 'New User' : 'Edit User'}
      </h1>

      {/* Account Info */}
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#9ca3af' }}>Account Info</p>
        <div className="bg-white rounded-lg p-5 flex flex-col gap-4" style={{ border: '1px solid #e5e7eb' }}>
          {/* Username */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <span className="text-sm font-semibold" style={{ color: '#374151' }}>Username</span>
              <span className="text-sm" style={{ color: '#dc2626' }}>*</span>
            </div>
            {!isNew && (
              <p className="text-xs" style={{ color: '#9ca3af' }}>Cannot be changed after creation.</p>
            )}
            {isNew && (
              <p className="text-xs" style={{ color: '#9ca3af' }}>Letters, numbers, underscores only.</p>
            )}
            <input type="text" value={username} onChange={e => setUsername(e.target.value)}
              placeholder="e.g. cashier1"
              disabled={!isNew}
              autoCapitalize="none"
              className="w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
              style={{
                border:     '1px solid #d1d5db',
                color:      isNew ? '#111827' : '#9ca3af',
                background: isNew ? '#fff'    : '#f3f4f6',
              }} />
          </div>

          {/* Full name */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <span className="text-sm font-semibold" style={{ color: '#374151' }}>Full Name</span>
              <span className="text-sm" style={{ color: '#dc2626' }}>*</span>
            </div>
            <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
              placeholder="e.g. Juan dela Cruz"
              className="w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
              style={{ border: '1px solid #d1d5db', color: '#111827' }} />
          </div>

          {/* Password (create) */}
          {isNew && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <span className="text-sm font-semibold" style={{ color: '#374151' }}>Password</span>
                <span className="text-sm" style={{ color: '#dc2626' }}>*</span>
              </div>
              <p className="text-xs" style={{ color: '#9ca3af' }}>Minimum 6 characters.</p>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
                style={{ border: '1px solid #d1d5db', color: '#111827' }} />
            </div>
          )}

          {/* New password (edit) */}
          {!isNew && (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold" style={{ color: '#374151' }}>New Password</span>
              <p className="text-xs" style={{ color: '#9ca3af' }}>Leave blank to keep current password.</p>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
                style={{ border: '1px solid #d1d5db', color: '#111827' }} />
            </div>
          )}
        </div>
      </div>

      {/* Role */}
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#9ca3af' }}>Role</p>
        <div className="flex flex-wrap gap-3">
          {ROLES.map(r => {
            const sel = role === r
            return (
              <button key={r} type="button" onClick={() => setRole(r)}
                className="flex-1 flex flex-col items-center py-3 px-2 rounded-lg"
                style={{
                  border:     `1.5px solid ${sel ? '#166534' : '#e5e7eb'}`,
                  background: sel ? '#f0fdf4' : '#fff',
                }}>
                <span className="text-sm font-bold"
                  style={{ color: sel ? '#15803d' : '#374151' }}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </span>
                <span className="text-xs mt-0.5"
                  style={{ color: sel ? '#16a34a' : '#9ca3af', textAlign: 'center' }}>
                  {r === 'cashier' ? 'POS only'
                    : r === 'manager' ? 'Reports + inventory'
                    : 'Full access'}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Status — edit only */}
      {!isNew && (
        <div className="mb-5">
          <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#9ca3af' }}>Status</p>
          <div className="bg-white rounded-lg p-4 flex items-center justify-between gap-4"
            style={{ border: '1px solid #e5e7eb' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: '#111827' }}>
                {isActive ? 'Active' : 'Inactive'}
              </p>
              <p className="text-xs" style={{ color: '#9ca3af' }}>
                {isActive
                  ? 'User can log in and use the app'
                  : 'User is blocked from logging in'}
              </p>
              {isSelf && (
                <p className="text-xs mt-1" style={{ color: '#9ca3af' }}>
                  You cannot change your own active status.
                </p>
              )}
            </div>
            <button type="button"
              disabled={isSelf}
              onClick={() => isSelf ? undefined : setToggleConfirm(true)}
              className="px-3 py-1.5 rounded-md text-sm font-bold disabled:opacity-40 shrink-0"
              style={{
                border:     `1.5px solid ${isActive ? '#dc2626' : '#166534'}`,
                color:      isActive ? '#dc2626' : '#15803d',
                background: isActive ? '#fef2f2' : '#f0fdf4',
              }}>
              {isActive ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg px-3 py-2 text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
          {error}
        </div>
      )}

      <button type="button" onClick={handleSave} disabled={saving}
        className="w-full py-3 rounded-lg text-sm font-bold text-white disabled:opacity-50"
        style={{ background: '#166534' }}>
        {saving ? 'Saving…' : isNew ? 'Create User' : 'Save Changes'}
      </button>

      {/* Toggle confirm modal */}
      {toggleConfirm && (
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setToggleConfirm(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-1" style={{ color: '#111827' }}>
              {isActive ? 'Deactivate User' : 'Activate User'}
            </h2>
            <p className="text-sm mb-5" style={{ color: '#6b7280' }}>
              {isActive
                ? `"${fullName}" will no longer be able to log in.`
                : `"${fullName}" will be able to log in again.`}
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setToggleConfirm(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ border: '1px solid #e5e7eb', color: '#374151' }}>Cancel</button>
              <button
                disabled={saving}
                onClick={async () => {
                  const next = !isActive
                  setError('')
                  setSaving(true)
                  try {
                    await updateUserProfile(editUid!, { is_active: next })
                    setIsActive(next)
                    setToggleConfirm(false)
                  } catch (e: unknown) {
                    setError((e as Error).message || 'Failed to update status.')
                  } finally {
                    setSaving(false)
                  }
                }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: isActive ? '#dc2626' : '#166534' }}>
                {saving ? 'Saving…' : isActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Users (main) ─────────────────────────────────────────────────────────────

export default function Users() {
  const { user } = useAuth()
  const isAdmin  = user?.role === 'admin'

  const [users,   setUsers]   = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [view,    setView]    = useState<View>({ kind: 'list' })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setUsers(await loadUsers())
    } catch (e: unknown) {
      const code = (e as { code?: string }).code ?? ''
      setError(
        code === 'permission-denied'
          ? 'Permission denied — Firestore rules may not allow listing users.'
          : `Failed to load users: ${(e as Error).message}`,
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function handleSaved() {
    setView({ kind: 'list' })
    load()
  }

  // ── Edit form (admin only) ────────────────────────────────────────────────────
  if (view.kind === 'editUser') {
    return (
      <AppLayout>
        <div className="overflow-y-auto" style={{ background: '#f9fafb', minHeight: '100%' }}>
          <UserEditForm
            users={users}
            editUid={view.uid}
            currentUid={user!.uid}
            onBack={() => setView({ kind: 'list' })}
            onSaved={handleSaved}
          />
        </div>
      </AppLayout>
    )
  }

  // ── List view ─────────────────────────────────────────────────────────────────
  const active   = users.filter(u => u.is_active)
  const inactive = users.filter(u => !u.is_active)

  return (
    <AppLayout>
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white" style={{ borderBottom: '1px solid #e5e7eb' }}>
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#111827' }}>Users</h1>
            <p className="text-xs mt-0.5" style={{ color: '#9ca3af' }}>
              {users.length} total · {active.length} active
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading}
              className="px-3 py-1 rounded-md text-sm font-semibold disabled:opacity-50"
              style={{ border: '1px solid #e5e7eb', color: '#15803d' }}>
              {loading ? '…' : '↻ Refresh'}
            </button>
            {isAdmin && (
              <button onClick={() => setView({ kind: 'editUser', uid: null })}
                className="px-4 py-2 rounded-lg text-sm font-bold text-white"
                style={{ background: '#166534' }}>
                + Add User
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6" style={{ background: '#f9fafb', minHeight: '100%' }}>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-sm" style={{ color: '#9ca3af' }}>Loading…</span>
          </div>
        ) : error ? (
          <div className="max-w-2xl mx-auto rounded-lg px-4 py-3"
            style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
            <p className="text-sm font-bold mb-0.5">Could not load users</p>
            <p className="text-xs">{error}</p>
          </div>
        ) : users.length === 0 ? (
          <p className="text-center py-20 text-sm" style={{ color: '#9ca3af' }}>No users found.</p>
        ) : (
          <div className="flex flex-col gap-6 max-w-2xl mx-auto">
            {/* Active section */}
            {active.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#9ca3af' }}>
                  Active
                </p>
                <div className="bg-white rounded-lg overflow-hidden shadow-sm"
                  style={{ border: '1px solid #e5e7eb' }}>
                  {active.map((u, i) => (
                    <UserRow
                      key={u.uid}
                      user={u}
                      isSelf={u.uid === user!.uid}
                      isAdmin={isAdmin}
                      divider={i > 0}
                      onClick={() => isAdmin && setView({ kind: 'editUser', uid: u.uid })}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Inactive section */}
            {inactive.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#9ca3af' }}>
                  Inactive
                </p>
                <div className="bg-white rounded-lg overflow-hidden shadow-sm"
                  style={{ border: '1px solid #e5e7eb' }}>
                  {inactive.map((u, i) => (
                    <UserRow
                      key={u.uid}
                      user={u}
                      isSelf={u.uid === user!.uid}
                      isAdmin={isAdmin}
                      divider={i > 0}
                      onClick={() => isAdmin && setView({ kind: 'editUser', uid: u.uid })}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  )
}

// ─── UserRow ──────────────────────────────────────────────────────────────────

function UserRow({
  user, isSelf, isAdmin, divider, onClick,
}: {
  user:    UserProfile
  isSelf:  boolean
  isAdmin: boolean
  divider: boolean
  onClick: () => void
}) {
  const rs = ROLE_STYLE[user.role] ?? ROLE_STYLE.cashier
  const initial = (user.full_name.charAt(0) || user.username.charAt(0) || '?').toUpperCase()

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 ${isAdmin ? 'cursor-pointer hover:bg-gray-50 transition-colors' : ''}`}
      style={divider ? { borderTop: '1px solid #f3f4f6' } : {}}
      onClick={onClick}>
      {/* Avatar */}
      <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
        style={{ background: '#dcfce7' }}>
        <span className="text-base font-bold" style={{ color: '#15803d' }}>{initial}</span>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: '#111827' }}>{user.full_name}</span>
          {isSelf && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded"
              style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #16a34a' }}>
              You
            </span>
          )}
        </div>
        <p className="text-xs" style={{ color: '#9ca3af' }}>@{user.username}</p>
      </div>

      {/* Role badge */}
      <span className="text-xs font-bold px-2 py-1 rounded capitalize shrink-0"
        style={{ background: rs.bg, color: rs.text, border: `1px solid ${rs.border}` }}>
        {user.role}
      </span>

      {isAdmin && <span className="text-lg shrink-0" style={{ color: '#d1d5db' }}>›</span>}
    </div>
  )
}
