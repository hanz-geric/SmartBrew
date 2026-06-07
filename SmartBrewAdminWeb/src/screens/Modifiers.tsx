import { useCallback, useEffect, useState } from 'react'
import { getDocs, setDoc, addDoc, deleteDoc, doc, query, orderBy } from 'firebase/firestore'
import { db } from '@/firebase/config'
import { modGroupsCol, stockCol } from '@/firebase/collections'
import AppLayout from '@/components/AppLayout'
import type { Modifier, ModifierGroup, RecipeLine, StockItem } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

type View = { kind: 'list' } | { kind: 'editGroup'; id: string | null }

interface LocalModifier extends Modifier {
  _key: string
}

function makeKey() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function makeNewModifier(): LocalModifier {
  const key = makeKey()
  return { _key: key, id: key, name: '', price_delta: 0, sort_order: 0, is_active: true }
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

async function fetchGroups(): Promise<ModifierGroup[]> {
  const snap = await getDocs(query(modGroupsCol(), orderBy('sort_order')))
  return snap.docs.map(d => ({
    id:          d.id,
    ...(d.data() as Omit<ModifierGroup, 'id'>),
    is_active:   d.data().is_active  ?? true,
    sort_order:  d.data().sort_order ?? 0,
    modifiers:   (d.data().modifiers ?? []) as Modifier[],
  }))
}

async function fetchStockItems(): Promise<StockItem[]> {
  const snap = await getDocs(stockCol())
  return snap.docs
    .map(d => ({ id: d.id, ...(d.data() as Omit<StockItem, 'id'>) }))
    .filter(s => s.is_active)
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className="text-xs font-bold px-1.5 py-0.5 rounded"
      style={{ background: color + '22', color, border: `1px solid ${color}` }}>
      {label}
    </span>
  )
}

function SectionLabel({ title }: { title: string }) {
  return (
    <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#9ca3af' }}>
      {title}
    </p>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className="relative inline-flex h-6 w-11 rounded-full transition-colors focus:outline-none shrink-0"
      style={{ background: value ? '#166534' : '#d1d5db' }}>
      <span className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
        style={{ transform: `translateX(${value ? '22px' : '2px'})`, marginTop: '2px' }} />
    </button>
  )
}

// ─── ModifierRow ──────────────────────────────────────────────────────────────

function ModifierRow({
  modifier, index, onChange, onRemove, canRemove, stockItems,
}: {
  modifier:   LocalModifier
  index:      number
  onChange:   (patch: Partial<LocalModifier>) => void
  onRemove:   () => void
  canRemove:  boolean
  stockItems: StockItem[]
}) {
  const lines = modifier.recipe_lines ?? []
  const validLines = lines.filter(l => l.stock_item_id && l.quantity_required > 0)
  const [showRecipe, setShowRecipe] = useState(lines.length > 0)

  function updateLine(i: number, patch: Partial<RecipeLine>) {
    onChange({ recipe_lines: lines.map((l, idx) => idx === i ? { ...l, ...patch } : l) })
  }

  function addLine() {
    onChange({ recipe_lines: [...lines, { stock_item_id: '', quantity_required: 0 }] })
  }

  function removeLine(i: number) {
    onChange({ recipe_lines: lines.filter((_, idx) => idx !== i) })
  }

  function toggleRecipe() {
    if (showRecipe && lines.length > 0) onChange({ recipe_lines: [] })
    setShowRecipe(v => !v)
  }

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #e5e7eb' }}>
      {/* Row header */}
      <div className="flex items-start gap-2 p-3" style={{ background: '#fff' }}>
        {/* Index badge */}
        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-1.5"
          style={{ background: '#f3f4f6' }}>
          <span className="text-xs font-bold" style={{ color: '#6b7280' }}>{index + 1}</span>
        </div>

        {/* Fields */}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <input type="text" value={modifier.name} onChange={e => onChange({ name: e.target.value })}
            placeholder="Option name (e.g. Extra Cream, Large)"
            className="w-full rounded-md px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-green-600"
            style={{ border: '1px solid #d1d5db', color: '#111827' }} />

          <div className="flex items-center gap-3 flex-wrap">
            {/* Price delta */}
            <div className="flex items-center rounded-md overflow-hidden"
              style={{ border: '1px solid #d1d5db', background: '#fff' }}>
              <span className="px-2 text-sm font-medium" style={{ color: '#6b7280' }}>+₱</span>
              <input type="number" min="0" step="0.01"
                value={modifier.price_delta === 0 ? '' : modifier.price_delta}
                onChange={e => onChange({ price_delta: parseFloat(e.target.value) || 0 })}
                placeholder="0.00"
                className="w-20 px-2 py-1.5 text-sm outline-none"
                style={{ color: '#111827' }} />
            </div>

            {/* Active toggle */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: '#6b7280' }}>Active</span>
              <Toggle value={modifier.is_active} onChange={v => onChange({ is_active: v })} />
            </div>
          </div>
        </div>

        {/* Remove */}
        {canRemove && (
          <button type="button" onClick={onRemove}
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
            style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
            ✕
          </button>
        )}
      </div>

      {/* Recipe toggle */}
      <button type="button" onClick={toggleRecipe}
        className="w-full text-left px-3 py-1 text-xs font-medium"
        style={{
          borderTop: '1px solid #e5e7eb',
          background: '#f9fafb',
          color: '#15803d',
        }}>
        {showRecipe
          ? `📦 ${validLines.length} ingredient${validLines.length !== 1 ? 's' : ''} — hide`
          : '📦 Add ingredient deductions'}
      </button>

      {/* Recipe builder */}
      {showRecipe && (
        <div className="p-3 flex flex-col gap-3"
          style={{ borderTop: '1px solid #e5e7eb', background: '#f0fdf4' }}>
          {stockItems.length === 0 ? (
            <p className="text-xs" style={{ color: '#9ca3af' }}>
              No active stock items. Create some in Stock Management first.
            </p>
          ) : (
            <>
              {lines.map((line, li) => {
                const linked = stockItems.find(s => s.id === line.stock_item_id)
                return (
                  <div key={li} className="rounded-md p-2 flex flex-col gap-2"
                    style={{ background: '#fff', border: '1px solid #e5e7eb' }}>
                    {/* Stock chips */}
                    <div className="flex flex-wrap gap-1">
                      {stockItems.map(si => {
                        const sel = line.stock_item_id === si.id
                        return (
                          <button key={si.id} type="button"
                            onClick={() => updateLine(li, { stock_item_id: si.id })}
                            className="px-2 py-1 rounded text-xs font-medium"
                            style={{
                              border:     `1.5px solid ${sel ? '#166534' : '#e5e7eb'}`,
                              background: sel ? '#f0fdf4' : '#fff',
                              color:      sel ? '#15803d' : '#6b7280',
                            }}>
                            {si.name}
                          </button>
                        )
                      })}
                    </div>
                    {/* Qty + unit + remove */}
                    <div className="flex items-center gap-2">
                      <input type="number" min="0" step="0.001"
                        value={line.quantity_required || ''}
                        onChange={e => updateLine(li, { quantity_required: parseFloat(e.target.value) || 0 })}
                        placeholder="Qty"
                        className="w-16 rounded px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-green-600"
                        style={{ border: '1px solid #d1d5db' }} />
                      <span className="text-sm flex-1" style={{ color: '#6b7280' }}>{linked?.unit ?? '—'}</span>
                      <button type="button" onClick={() => removeLine(li)}
                        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{ background: '#fef2f2', color: '#dc2626' }}>
                        ✕
                      </button>
                    </div>
                  </div>
                )
              })}
              <button type="button" onClick={addLine}
                className="py-1.5 rounded text-xs font-semibold"
                style={{ border: '1.5px dashed #16a34a', color: '#15803d' }}>
                + Add Ingredient
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ModifierGroupEditForm ────────────────────────────────────────────────────

function ModifierGroupEditForm({
  groups, editId, stockItems, onBack, onSaved,
}: {
  groups:     ModifierGroup[]
  editId:     string | null
  stockItems: StockItem[]
  onBack:     () => void
  onSaved:    () => void
}) {
  const isNew    = editId === null
  const existing = editId ? groups.find(g => g.id === editId) : null

  const [name,       setName]       = useState(existing?.name       ?? '')
  const [isRequired, setIsRequired] = useState(existing?.is_required ?? false)
  const [maxSelect,  setMaxSelect]  = useState(String(existing?.max_select  ?? 1))
  const [sortOrder,  setSortOrder]  = useState(String(existing?.sort_order  ?? 0))
  const [isActive,   setIsActive]   = useState(existing?.is_active  ?? true)
  const [modifiers,  setModifiers]  = useState<LocalModifier[]>(
    existing && existing.modifiers.length > 0
      ? existing.modifiers.map(m => ({ ...m, _key: m.id }))
      : [makeNewModifier()],
  )
  const [saving,      setSaving]      = useState(false)
  const [deleting,    setDeleting]    = useState(false)
  const [deleteModal, setDeleteModal] = useState(false)
  const [error,       setError]       = useState('')

  function updateModifier(key: string, patch: Partial<LocalModifier>) {
    setModifiers(prev => prev.map(m => m._key === key ? { ...m, ...patch } : m))
  }

  function removeModifier(key: string) {
    setModifiers(prev => {
      const next = prev.filter(m => m._key !== key)
      return next.length > 0 ? next : [makeNewModifier()]
    })
  }

  async function handleSave() {
    setError('')
    const trimmed = name.trim()
    const maxSel  = parseInt(maxSelect, 10)
    const sortNum = parseInt(sortOrder, 10)
    if (!trimmed)                      { setError('Group name is required.'); return }
    if (isNaN(maxSel) || maxSel < 1)   { setError('Max selections must be at least 1.'); return }
    if (isNaN(sortNum) || sortNum < 0) { setError('Sort order must be 0 or higher.'); return }

    const validMods = modifiers.filter(m => m.name.trim() !== '')
    if (validMods.length === 0) { setError('Add at least one modifier option.'); return }

    const cleanMods: Modifier[] = validMods.map((m, i) => ({
      id:           m.id,
      name:         m.name.trim(),
      price_delta:  parseFloat(String(m.price_delta)) || 0,
      sort_order:   m.sort_order ?? i,
      is_active:    m.is_active,
      recipe_lines: (m.recipe_lines ?? []).filter(
        l => l.stock_item_id && l.quantity_required > 0,
      ),
    }))

    const data: Omit<ModifierGroup, 'id'> = {
      name:        trimmed,
      is_required: isRequired,
      max_select:  maxSel,
      sort_order:  sortNum,
      is_active:   isActive,
      modifiers:   cleanMods,
    }

    setSaving(true)
    try {
      if (editId) {
        await setDoc(doc(db, 'modifier_groups', editId), data, { merge: true })
      } else {
        await addDoc(modGroupsCol(), data)
      }
      onSaved()
    } catch (e: unknown) {
      const code = (e as { code?: string }).code ?? ''
      setError(code === 'permission-denied' ? 'Permission denied.' : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    if (!editId) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'modifier_groups', editId))
      onSaved()
    } catch (e: unknown) {
      setError((e as { code?: string }).code === 'permission-denied' ? 'Permission denied.' : 'Failed to delete.')
      setDeleting(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button onClick={onBack} className="text-sm font-medium mb-2 block" style={{ color: '#15803d' }}>
        ‹ Back
      </button>
      <h1 className="text-xl font-bold mb-6" style={{ color: '#111827' }}>
        {isNew ? 'New Modifier Group' : 'Edit Modifier Group'}
      </h1>

      {/* ── Group Settings ── */}
      <div className="mb-6">
        <SectionLabel title="Group Settings" />
        <div className="bg-white rounded-lg p-5 flex flex-col gap-5" style={{ border: '1px solid #e5e7eb' }}>
          {/* Name */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <span className="text-sm font-semibold" style={{ color: '#374151' }}>Group Name</span>
              <span className="text-sm" style={{ color: '#dc2626' }}>*</span>
            </div>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Size, Temperature, Sugar Level"
              className="w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
              style={{ border: '1px solid #d1d5db', color: '#111827' }} />
          </div>

          {/* Max select + Sort order */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold" style={{ color: '#374151' }}>Max Selections</span>
              <p className="text-xs" style={{ color: '#9ca3af' }}>How many options a customer can pick</p>
              <input type="number" min="1" value={maxSelect} onChange={e => setMaxSelect(e.target.value)}
                placeholder="1"
                className="w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
                style={{ border: '1px solid #d1d5db', color: '#111827' }} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold" style={{ color: '#374151' }}>Sort Order</span>
              <p className="text-xs" style={{ color: '#9ca3af' }}>Lower numbers appear first</p>
              <input type="number" min="0" value={sortOrder} onChange={e => setSortOrder(e.target.value)}
                placeholder="0"
                className="w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
                style={{ border: '1px solid #d1d5db', color: '#111827' }} />
            </div>
          </div>

          {/* Required toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold" style={{ color: '#374151' }}>Required</p>
              <p className="text-xs" style={{ color: '#9ca3af' }}>Customer must choose before adding to cart</p>
            </div>
            <Toggle value={isRequired} onChange={setIsRequired} />
          </div>

          {/* Active toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold" style={{ color: '#374151' }}>Active</p>
              <p className="text-xs" style={{ color: '#9ca3af' }}>Inactive groups are hidden from the POS</p>
            </div>
            <Toggle value={isActive} onChange={setIsActive} />
          </div>
        </div>
      </div>

      {/* ── Options ── */}
      <div className="mb-6">
        <SectionLabel title="Options" />
        <p className="text-xs mb-3" style={{ color: '#9ca3af' }}>
          Each option appears as a selectable button when adding a product to the cart.
        </p>
        <div className="flex flex-col gap-3">
          {modifiers.map((m, i) => (
            <ModifierRow
              key={m._key}
              modifier={m}
              index={i}
              onChange={patch => updateModifier(m._key, patch)}
              onRemove={() => removeModifier(m._key)}
              canRemove={modifiers.length > 1 || m.name.trim() !== ''}
              stockItems={stockItems}
            />
          ))}
          <button type="button"
            onClick={() => setModifiers(prev => [...prev, makeNewModifier()])}
            className="py-2.5 rounded-lg text-sm font-semibold"
            style={{ border: '1.5px dashed #16a34a', color: '#15803d' }}>
            + Add Option
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg px-3 py-2 text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
          {error}
        </div>
      )}

      {/* Save */}
      <button type="button" onClick={handleSave} disabled={saving || deleting}
        className="w-full py-3 rounded-lg text-sm font-bold text-white disabled:opacity-50 mb-6"
        style={{ background: '#166534' }}>
        {saving ? 'Saving…' : isNew ? 'Create Group' : 'Save Changes'}
      </button>

      {/* ── Danger Zone (edit only) ── */}
      {!isNew && (
        <div className="mb-6">
          <SectionLabel title="Danger Zone" />
          <div className="bg-white rounded-lg p-5" style={{ border: '1px solid #e5e7eb' }}>
            <p className="text-sm mb-4" style={{ color: '#6b7280' }}>
              Deleting removes this group from all products that use it. This cannot be undone.
            </p>
            <button type="button" onClick={() => setDeleteModal(true)} disabled={saving || deleting}
              className="px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50"
              style={{ border: '1.5px solid #dc2626', color: '#dc2626' }}>
              {deleting ? 'Deleting…' : 'Delete Group'}
            </button>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteModal && (
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setDeleteModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl"
            onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold mb-1" style={{ color: '#111827' }}>Delete Group</h2>
            <p className="text-sm mb-5" style={{ color: '#6b7280' }}>
              Delete "{name}"? Any products using this group will lose these modifier options. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ border: '1px solid #e5e7eb', color: '#374151' }}>Cancel</button>
              <button onClick={() => { setDeleteModal(false); doDelete() }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                style={{ background: '#dc2626' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Modifiers (main) ─────────────────────────────────────────────────────────

export default function Modifiers() {
  const [groups,     setGroups]     = useState<ModifierGroup[]>([])
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [loading,    setLoading]    = useState(true)
  const [view,       setView]       = useState<View>({ kind: 'list' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [g, s] = await Promise.all([fetchGroups(), fetchStockItems()])
      setGroups(g)
      setStockItems(s)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function handleSaved() {
    setView({ kind: 'list' })
    load()
  }

  // ── Edit form ─────────────────────────────────────────────────────────────────
  if (view.kind === 'editGroup') {
    return (
      <AppLayout>
        <div className="overflow-y-auto" style={{ background: '#f9fafb', minHeight: '100%' }}>
          <ModifierGroupEditForm
            groups={groups}
            editId={view.id}
            stockItems={stockItems}
            onBack={() => setView({ kind: 'list' })}
            onSaved={handleSaved}
          />
        </div>
      </AppLayout>
    )
  }

  // ── List view ─────────────────────────────────────────────────────────────────
  return (
    <AppLayout>
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white" style={{ borderBottom: '1px solid #e5e7eb' }}>
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#111827' }}>Modifier Groups</h1>
            <p className="text-xs mt-0.5" style={{ color: '#9ca3af' }}>
              Groups of options assigned to products (e.g. Size: Small, Medium, Large)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading}
              className="px-3 py-1 rounded-md text-sm font-semibold disabled:opacity-50"
              style={{ border: '1px solid #e5e7eb', color: '#15803d' }}>
              {loading ? '…' : '↻ Refresh'}
            </button>
            <button onClick={() => setView({ kind: 'editGroup', id: null })}
              className="px-4 py-2 rounded-lg text-sm font-bold text-white"
              style={{ background: '#166534' }}>
              + Add Group
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6" style={{ background: '#f9fafb', minHeight: '100%' }}>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-sm" style={{ color: '#9ca3af' }}>Loading…</span>
          </div>
        ) : groups.length === 0 ? (
          <p className="text-center py-20 text-sm" style={{ color: '#9ca3af' }}>
            No modifier groups yet. Click "+ Add Group" to create one.
          </p>
        ) : (
          <div className="flex flex-col gap-3 max-w-3xl mx-auto">
            {groups.map(g => {
              const active   = g.modifiers.filter(m => m.is_active !== false)
              const inactive = g.modifiers.filter(m => m.is_active === false)
              return (
                <div key={g.id}
                  className="bg-white rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow shadow-sm"
                  style={{ border: '1px solid #e5e7eb' }}
                  onClick={() => setView({ kind: 'editGroup', id: g.id })}>
                  {/* Card header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold" style={{ color: '#111827' }}>{g.name}</span>
                        {g.is_active === false && <Badge label="Inactive" color="#9ca3af" />}
                        {g.is_required          && <Badge label="Required" color="#166534" />}
                      </div>
                      <p className="text-xs" style={{ color: '#9ca3af' }}>
                        Max select: {g.max_select} · {g.modifiers.length} option{g.modifiers.length !== 1 ? 's' : ''}
                        {inactive.length > 0 ? ` (${inactive.length} inactive)` : ''}
                        {g.sort_order !== undefined ? ` · order #${g.sort_order}` : ''}
                      </p>
                    </div>
                    <span className="text-lg shrink-0" style={{ color: '#d1d5db' }}>›</span>
                  </div>

                  {/* Options preview */}
                  {g.modifiers.length > 0 && (
                    <>
                      <div className="my-3" style={{ borderTop: '1px solid #f3f4f6' }} />
                      <div className="flex flex-col gap-1">
                        {active.slice(0, 6).map(m => (
                          <div key={m.id} className="flex items-center justify-between">
                            <span className="text-sm" style={{ color: '#374151' }}>{m.name}</span>
                            <span className="text-xs" style={{ color: '#9ca3af' }}>
                              {m.price_delta === 0 ? 'free' : `+₱${m.price_delta.toFixed(2)}`}
                              {(m.recipe_lines ?? []).filter(l => l.stock_item_id).length > 0
                                ? ` · ${(m.recipe_lines ?? []).filter(l => l.stock_item_id).length} ingredient${(m.recipe_lines ?? []).filter(l => l.stock_item_id).length > 1 ? 's' : ''}`
                                : ''}
                            </span>
                          </div>
                        ))}
                        {active.length > 6 && (
                          <p className="text-xs" style={{ color: '#9ca3af' }}>
                            +{active.length - 6} more option{active.length - 6 > 1 ? 's' : ''}
                          </p>
                        )}
                        {g.modifiers.length === 0 && (
                          <p className="text-xs italic" style={{ color: '#9ca3af' }}>No options — tap to add some.</p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
