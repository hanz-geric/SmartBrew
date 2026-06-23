import { useCallback, useEffect, useState } from 'react'
import {
  getDocs, setDoc, addDoc, updateDoc, deleteDoc, doc, increment,
} from 'firebase/firestore'
import { db } from '@/firebase/config'
import { stockCol } from '@/firebase/collections'
import { useAuth } from '@/context/AuthContext'
import AppLayout from '@/components/AppLayout'
import type { StockItem, StockStatus } from '@/types'

// ─── Constants ────────────────────────────────────────────────────────────────

type View = { kind: 'list' } | { kind: 'editItem'; id: string | null }

type StatusFilter = 'all' | 'low' | 'out'

const COMMON_UNITS = ['g', 'kg', 'mL', 'L', 'pcs', 'bags', 'boxes', 'shots'] as const

const REASONS = [
  'Restock / Delivery',
  'Waste / Spoilage',
  'Stock Correction',
  'Manual Adjustment',
] as const
type Reason = typeof REASONS[number]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stockStatus(qty: number, reorderLevel: number): StockStatus {
  if (qty <= 0)                              return 'out'
  if (reorderLevel > 0 && qty <= reorderLevel) return 'low'
  return 'ok'
}

function statusStyle(status: StockStatus) {
  switch (status) {
    case 'out': return { bg: '#fef2f2', border: '#dc2626', text: '#dc2626', label: 'Out of Stock' }
    case 'low': return { bg: '#fffbeb', border: '#d97706', text: '#d97706', label: 'Low Stock'    }
    default:    return { bg: '#f0fdf4', border: '#16a34a', text: '#15803d', label: 'OK'           }
  }
}

async function loadItems(): Promise<StockItem[]> {
  const snap = await getDocs(stockCol())
  return snap.docs
    .map(d => {
      const data = d.data()
      const qty     = (data.quantity_on_hand as number) ?? 0
      const reorder = (data.reorder_level    as number) ?? 0
      return {
        id:               d.id,
        name:             data.name             as string,
        unit:             data.unit             as string,
        quantity_on_hand: qty,
        reorder_level:    reorder,
        cost_per_unit:    (data.cost_per_unit   as number) ?? 0,
        is_active:        data.is_active !== false,
        stock_status:     stockStatus(qty, reorder),
      } as StockItem
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

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

// ─── StockItemEditForm ────────────────────────────────────────────────────────

function StockItemEditForm({
  items, editId, onBack, onSaved,
}: {
  items:   StockItem[]
  editId:  string | null
  onBack:  () => void
  onSaved: () => void
}) {
  const isNew    = editId === null
  const existing = editId ? items.find(s => s.id === editId) : null

  const [name,         setName]         = useState(existing?.name ?? '')
  const [unit,         setUnit]         = useState(() => {
    if (!existing) return ''
    return (COMMON_UNITS as readonly string[]).includes(existing.unit) ? existing.unit : ''
  })
  const [customUnit,   setCustomUnit]   = useState(() =>
    existing && !(COMMON_UNITS as readonly string[]).includes(existing.unit) ? existing.unit : '',
  )
  const [useCustom,    setUseCustom]    = useState(
    !!(existing && !(COMMON_UNITS as readonly string[]).includes(existing.unit)),
  )
  const [qtyOnHand,    setQtyOnHand]    = useState(String(existing?.quantity_on_hand ?? 0))
  const [reorderLevel, setReorderLevel] = useState(String(existing?.reorder_level    ?? 0))
  const [costPerUnit,  setCostPerUnit]  = useState(
    existing?.cost_per_unit && existing.cost_per_unit > 0 ? String(existing.cost_per_unit) : '',
  )
  const [isActive, setIsActive] = useState(existing?.is_active ?? true)

  // Batch cost calculator
  const [calcQty,   setCalcQty]   = useState('')
  const [calcUnit,  setCalcUnit]  = useState<'same' | 'kg' | 'g' | 'L' | 'mL'>('same')
  const [calcPrice, setCalcPrice] = useState('')

  const [saving,      setSaving]      = useState(false)
  const [deleting,    setDeleting]    = useState(false)
  const [deleteModal, setDeleteModal] = useState(false)
  const [error,       setError]       = useState('')

  function resolvedUnit() {
    return useCustom ? customUnit.trim() : unit
  }

  type CalcField = 'qty' | 'unit' | 'price'
  type CalcUnitVal = 'same' | 'kg' | 'g' | 'L' | 'mL'

  function computeCostPerUnit(
    qtyVal: string,
    unitVal: CalcUnitVal,
    priceVal: string,
    itemUnit: string,
  ): string | null {
    const qty   = parseFloat(qtyVal)
    const price = parseFloat(priceVal)
    if (!qty || !price || qty <= 0 || price <= 0) return null

    const purchaseUnit = unitVal === 'same' ? itemUnit : unitVal

    const toGrams: Record<string, number> = { g: 1, kg: 1000 }
    const toMl:    Record<string, number> = { mL: 1, L: 1000 }

    let qtyInItemUnit = qty
    if (purchaseUnit !== itemUnit) {
      if (toGrams[purchaseUnit] !== undefined && toGrams[itemUnit] !== undefined) {
        qtyInItemUnit = qty * toGrams[purchaseUnit] / toGrams[itemUnit]
      } else if (toMl[purchaseUnit] !== undefined && toMl[itemUnit] !== undefined) {
        qtyInItemUnit = qty * toMl[purchaseUnit] / toMl[itemUnit]
      } else {
        return null
      }
    }
    return (price / qtyInItemUnit).toFixed(4)
  }

  function handleCalcChange(field: CalcField, value: string) {
    const nextQty   = field === 'qty'   ? value : calcQty
    const nextUnit  = field === 'unit'  ? value as CalcUnitVal : calcUnit
    const nextPrice = field === 'price' ? value : calcPrice

    if (field === 'qty')   setCalcQty(value)
    if (field === 'unit')  setCalcUnit(value as CalcUnitVal)
    if (field === 'price') setCalcPrice(value)

    const result = computeCostPerUnit(nextQty, nextUnit, nextPrice, resolvedUnit())
    if (result !== null) setCostPerUnit(result)
  }

  // Preview for the calc result box
  const calcPreview = (() => {
    const result = computeCostPerUnit(calcQty, calcUnit, calcPrice, resolvedUnit())
    if (!result) return null
    const iUnit = resolvedUnit() || 'unit'
    const pUnit = calcUnit === 'same' ? iUnit : calcUnit
    const toGrams: Record<string, number> = { g: 1, kg: 1000 }
    const toMl:    Record<string, number> = { mL: 1, L: 1000 }
    const qty = parseFloat(calcQty)
    let totalInItemUnit = qty
    if (pUnit !== iUnit) {
      if (toGrams[pUnit] !== undefined && toGrams[iUnit] !== undefined)
        totalInItemUnit = qty * toGrams[pUnit] / toGrams[iUnit]
      else if (toMl[pUnit] !== undefined && toMl[iUnit] !== undefined)
        totalInItemUnit = qty * toMl[pUnit] / toMl[iUnit]
    }
    return { costPerUnit: result, totalInItemUnit: totalInItemUnit.toFixed(2), iUnit }
  })()

  async function handleSave() {
    setError('')
    const trimmed = name.trim()
    const rUnit   = resolvedUnit()
    if (!trimmed) { setError('Name is required.'); return }
    if (!rUnit)   { setError('Unit is required.'); return }
    const qty     = parseFloat(qtyOnHand)
    const reorder = parseFloat(reorderLevel)
    if (isNaN(qty))     { setError('Quantity on hand must be a number.'); return }
    if (isNaN(reorder)) { setError('Reorder level must be a number.'); return }
    const cost    = parseFloat(costPerUnit) || 0

    const data: Omit<StockItem, 'id' | 'stock_status'> = {
      name:             trimmed,
      unit:             rUnit,
      quantity_on_hand: Math.max(0, qty),
      reorder_level:    Math.max(0, reorder),
      cost_per_unit:    cost,
      is_active:        isActive,
    }

    setSaving(true)
    try {
      if (editId) {
        await setDoc(doc(db, 'stock_items', editId), data, { merge: true })
      } else {
        await addDoc(stockCol(), data)
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
      await deleteDoc(doc(db, 'stock_items', editId))
      onSaved()
    } catch (e: unknown) {
      setError((e as { code?: string }).code === 'permission-denied' ? 'Permission denied.' : 'Failed to delete.')
      setDeleting(false)
    }
  }

  const iUnit = resolvedUnit() || 'unit'

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button onClick={onBack} className="text-sm font-medium mb-2 block" style={{ color: '#15803d' }}>
        ‹ Back
      </button>
      <h1 className="text-xl font-bold mb-6" style={{ color: '#111827' }}>
        {isNew ? 'New Stock Item' : 'Edit Stock Item'}
      </h1>

      <div className="bg-white rounded-lg p-5 flex flex-col gap-5 mb-4"
        style={{ border: '1px solid #e5e7eb' }}>

        {/* Name */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <span className="text-sm font-semibold" style={{ color: '#374151' }}>Name</span>
            <span className="text-sm" style={{ color: '#dc2626' }}>*</span>
          </div>
          <input type="text" value={name} onChange={e => { setName(e.target.value); setError('') }}
            placeholder="e.g. Espresso Beans, Whole Milk"
            className="w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
            style={{ border: '1px solid #d1d5db', color: '#111827' }} />
        </div>

        {/* Unit */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1">
            <span className="text-sm font-semibold" style={{ color: '#374151' }}>Unit</span>
            <span className="text-sm" style={{ color: '#dc2626' }}>*</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {COMMON_UNITS.map(u => {
              const sel = !useCustom && unit === u
              return (
                <button key={u} type="button"
                  onClick={() => { setUnit(u); setUseCustom(false); setError('') }}
                  className="px-3 py-1.5 rounded-md text-sm font-medium"
                  style={{
                    border:     `1.5px solid ${sel ? '#166534' : 'transparent'}`,
                    background: sel ? '#f0fdf4' : '#f3f4f6',
                    color:      sel ? '#15803d' : '#6b7280',
                    fontWeight: sel ? '700' : '500',
                  }}>
                  {u}
                </button>
              )
            })}
            <button type="button"
              onClick={() => { setUseCustom(true); setUnit(''); setError('') }}
              className="px-3 py-1.5 rounded-md text-sm font-medium"
              style={{
                border:     `1.5px solid ${useCustom ? '#166534' : 'transparent'}`,
                background: useCustom ? '#f0fdf4' : '#f3f4f6',
                color:      useCustom ? '#15803d' : '#6b7280',
                fontWeight: useCustom ? '700' : '500',
              }}>
              Other
            </button>
          </div>
          {useCustom && (
            <input type="text" value={customUnit} onChange={e => { setCustomUnit(e.target.value); setError('') }}
              placeholder="e.g. sachets, tubs, gallons"
              autoFocus
              className="w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
              style={{ border: '1px solid #d1d5db', color: '#111827' }} />
          )}
        </div>

        {/* Qty + Reorder */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold" style={{ color: '#374151' }}>Qty on Hand</span>
            <div className="flex items-center gap-1">
              <input type="number" min="0" step="0.001" value={qtyOnHand}
                onChange={e => { setQtyOnHand(e.target.value); setError('') }}
                className="flex-1 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
                style={{ border: '1px solid #d1d5db', color: '#111827' }} />
              <span className="text-sm shrink-0" style={{ color: '#9ca3af' }}>{iUnit}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold" style={{ color: '#374151' }}>Alert Below</span>
            <div className="flex items-center gap-1">
              <input type="number" min="0" step="0.001" value={reorderLevel}
                onChange={e => { setReorderLevel(e.target.value); setError('') }}
                className="flex-1 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
                style={{ border: '1px solid #d1d5db', color: '#111827' }} />
              <span className="text-sm shrink-0" style={{ color: '#9ca3af' }}>{iUnit}</span>
            </div>
            <p className="text-xs" style={{ color: '#9ca3af' }}>0 to disable</p>
          </div>
        </div>

        {/* Batch cost calculator */}
        <div className="flex flex-col gap-2 rounded-md p-4" style={{ background: '#f9fafb', border: '1px solid #e5e7eb' }}>
          <p className="text-sm font-semibold" style={{ color: '#374151' }}>
            Batch Cost Calculator <span className="text-xs font-normal" style={{ color: '#9ca3af' }}>optional</span>
          </p>
          <p className="text-xs" style={{ color: '#9ca3af' }}>
            Fill in what you paid for a batch to auto-calculate cost per unit.
          </p>
          <div className="flex items-center flex-wrap gap-2 mt-1">
            <span className="text-sm font-medium" style={{ color: '#6b7280' }}>Bought</span>
            <input type="number" min="0" step="0.001" value={calcQty}
              onChange={e => handleCalcChange('qty', e.target.value)}
              placeholder="qty"
              className="w-20 rounded-md px-2 py-1.5 text-sm text-center outline-none focus:ring-2 focus:ring-green-600"
              style={{ border: '1px solid #d1d5db' }} />
            {/* Purchase unit chips */}
            <div className="flex flex-wrap gap-1">
              {(['same', 'kg', 'g', 'L', 'mL'] as const).map(u => {
                const label = u === 'same' ? (iUnit || 'unit') : u
                const sel   = calcUnit === u
                return (
                  <button key={u} type="button" onClick={() => handleCalcChange('unit', u)}
                    className="px-2 py-1 rounded text-xs font-medium"
                    style={{
                      border:     `1.5px solid ${sel ? '#166534' : '#e5e7eb'}`,
                      background: sel ? '#f0fdf4' : '#fff',
                      color:      sel ? '#15803d' : '#6b7280',
                    }}>
                    {label}
                  </button>
                )
              })}
            </div>
            <span className="text-sm font-medium" style={{ color: '#6b7280' }}>for ₱</span>
            <input type="number" min="0" step="0.01" value={calcPrice}
              onChange={e => handleCalcChange('price', e.target.value)}
              placeholder="price"
              className="w-24 rounded-md px-2 py-1.5 text-sm text-center outline-none focus:ring-2 focus:ring-green-600"
              style={{ border: '1px solid #d1d5db' }} />
          </div>
          {calcPreview && (
            <div className="rounded-md px-3 py-2 mt-1"
              style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
              <p className="text-sm font-bold" style={{ color: '#15803d' }}>
                → ₱{calcPreview.costPerUnit} per {calcPreview.iUnit}
                {'  '}({calcPreview.totalInItemUnit} {calcPreview.iUnit} total)
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#16a34a' }}>Cost/unit field updated automatically.</p>
            </div>
          )}
        </div>

        {/* Cost per unit */}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold" style={{ color: '#374151' }}>
            Cost per Unit (₱) <span className="text-xs font-normal" style={{ color: '#9ca3af' }}>optional</span>
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium" style={{ color: '#6b7280' }}>₱</span>
            <input type="number" min="0" step="0.0001" value={costPerUnit}
              onChange={e => setCostPerUnit(e.target.value)}
              placeholder="0.0000"
              className="w-36 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
              style={{ border: '1px solid #d1d5db', color: '#111827' }} />
            <span className="text-sm" style={{ color: '#9ca3af' }}>/ {iUnit}</span>
          </div>
        </div>

        {/* Active toggle — edit only */}
        {!isNew && (
          <>
            <div style={{ borderTop: '1px solid #f3f4f6' }} />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold" style={{ color: '#374151' }}>Active</p>
                <p className="text-xs" style={{ color: '#9ca3af' }}>Inactive items are hidden from product tracking</p>
              </div>
              <Toggle value={isActive} onChange={setIsActive} />
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg px-3 py-2 text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
          {error}
        </div>
      )}

      <button type="button" onClick={handleSave} disabled={saving || deleting}
        className="w-full py-3 rounded-lg text-sm font-bold text-white disabled:opacity-50 mb-6"
        style={{ background: '#166534' }}>
        {saving ? 'Saving…' : isNew ? 'Add Stock Item' : 'Update Stock Item'}
      </button>

      {/* Danger zone */}
      {!isNew && (
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#9ca3af' }}>Danger Zone</p>
          <div className="bg-white rounded-lg p-5" style={{ border: '1px solid #e5e7eb' }}>
            <p className="text-sm mb-4" style={{ color: '#6b7280' }}>
              Deleting removes this item permanently. Products using it for tracking will lose their link.
            </p>
            <button type="button" onClick={() => setDeleteModal(true)} disabled={saving || deleting}
              className="px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50"
              style={{ border: '1.5px solid #dc2626', color: '#dc2626' }}>
              {deleting ? 'Deleting…' : 'Delete Item'}
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
            <h2 className="text-base font-bold mb-1" style={{ color: '#111827' }}>Delete Stock Item</h2>
            <p className="text-sm mb-5" style={{ color: '#6b7280' }}>Delete "{name}"? This cannot be undone.</p>
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

// ─── Stock (main) ─────────────────────────────────────────────────────────────

export default function Stock() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [items,   setItems]   = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [view,    setView]    = useState<View>({ kind: 'list' })

  // Filter state
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')

  // Inline adjust state (one open at a time)
  const [expandedId,   setExpandedId]   = useState<string | null>(null)
  const [adjustDelta,  setAdjustDelta]  = useState('')
  const [adjustReason, setAdjustReason] = useState<Reason>(REASONS[0])
  const [adjustNotes,  setAdjustNotes]  = useState('')
  const [adjusting,    setAdjusting]    = useState(false)
  const [adjustError,  setAdjustError]  = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setItems(await loadItems()) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  function handleSaved() {
    setView({ kind: 'list' })
    load()
  }

  function openAdjust(item: StockItem) {
    if (expandedId === item.id) { setExpandedId(null); return }
    setExpandedId(item.id)
    setAdjustDelta('')
    setAdjustReason(REASONS[0])
    setAdjustNotes('')
    setAdjustError('')
    setAdjusting(false)
  }

  async function handleAdjust() {
    const delta = parseFloat(adjustDelta)
    if (!adjustDelta.trim() || isNaN(delta) || delta === 0) {
      setAdjustError('Enter a non-zero quantity (positive to add, negative to subtract).')
      return
    }
    const target = items.find(i => i.id === expandedId)
    if (!target) return

    setAdjusting(true)
    setAdjustError('')
    try {
      await updateDoc(doc(db, 'stock_items', target.id), { quantity_on_hand: increment(delta) })
      const newQty = target.quantity_on_hand + delta
      setItems(prev => prev.map(i => {
        if (i.id !== target.id) return i
        return { ...i, quantity_on_hand: newQty, stock_status: stockStatus(newQty, i.reorder_level) }
      }))
      setExpandedId(null)
    } catch {
      setAdjustError('Failed to adjust. Check your connection.')
    } finally {
      setAdjusting(false)
    }
  }

  // ── Edit form ──────────────────────────────────────────────────────────────
  if (view.kind === 'editItem') {
    return (
      <AppLayout>
        <div className="overflow-y-auto" style={{ background: '#f9fafb', minHeight: '100%' }}>
          <StockItemEditForm
            items={items}
            editId={view.id}
            onBack={() => setView({ kind: 'list' })}
            onSaved={handleSaved}
          />
        </div>
      </AppLayout>
    )
  }

  // ── List view ─────────────────────────────────────────────────────────────
  const active  = items.filter(i => i.is_active)
  const outList = active.filter(i => i.stock_status === 'out')
  const lowList = active.filter(i => i.stock_status === 'low')

  const displayed = items.filter(item => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase())
    const matchFilter =
      filter === 'low' ? item.stock_status === 'low' :
      filter === 'out' ? item.stock_status === 'out' : true
    return matchSearch && matchFilter
  })

  return (
    <AppLayout>
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white" style={{ borderBottom: '1px solid #e5e7eb' }}>
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#111827' }}>Stock</h1>
            <p className="text-xs mt-0.5" style={{ color: '#9ca3af' }}>
              {active.length} active item{active.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading}
              className="px-3 py-1 rounded-md text-sm font-semibold disabled:opacity-50"
              style={{ border: '1px solid #e5e7eb', color: '#15803d' }}>
              {loading ? '…' : '↻ Refresh'}
            </button>
            {isAdmin && (
              <button onClick={() => setView({ kind: 'editItem', id: null })}
                className="px-4 py-2 rounded-lg text-sm font-bold text-white"
                style={{ background: '#166534' }}>
                + Add Item
              </button>
            )}
          </div>
        </div>

        {/* Search + filter */}
        <div className="flex items-center gap-3 px-6 pb-3 flex-wrap">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search items…"
            className="flex-1 min-w-0 rounded-md px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-green-600"
            style={{ border: '1px solid #d1d5db', color: '#111827' }} />
          <div className="flex gap-1.5">
            {([
              ['all', 'All'],
              ['low', `Low (${lowList.length})`],
              ['out', `Out (${outList.length})`],
            ] as [StatusFilter, string][]).map(([val, label]) => {
              const sel = filter === val
              return (
                <button key={val} type="button" onClick={() => setFilter(val)}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                  style={{
                    background: sel ? '#166534' : '#f3f4f6',
                    color:      sel ? '#fff'     : '#6b7280',
                  }}>
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6" style={{ background: '#f9fafb', minHeight: '100%' }}>
        {/* Alert strip */}
        {!loading && (outList.length > 0 || lowList.length > 0) && (
          <div className="mb-4 rounded-lg px-4 py-2 text-sm font-medium max-w-3xl mx-auto"
            style={{ background: '#fffbeb', color: '#d97706', border: '1px solid rgba(217,119,6,0.3)' }}>
            ⚠️
            {outList.length > 0 ? ` ${outList.length} out of stock` : ''}
            {outList.length > 0 && lowList.length > 0 ? ' ·' : ''}
            {lowList.length > 0 ? ` ${lowList.length} low stock` : ''}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-sm" style={{ color: '#9ca3af' }}>Loading…</span>
          </div>
        ) : displayed.length === 0 ? (
          <p className="text-center py-20 text-sm" style={{ color: '#9ca3af' }}>
            {search || filter !== 'all' ? 'No items match your filter.' : 'No stock items yet.'}
          </p>
        ) : (
          <div className="flex flex-col gap-2 max-w-3xl mx-auto">
            {displayed.map(item => {
              const sc         = statusStyle(item.stock_status)
              const isExpanded = expandedId === item.id
              const qtyDisplay = item.quantity_on_hand % 1 === 0
                ? item.quantity_on_hand.toString()
                : item.quantity_on_hand.toFixed(2)

              return (
                <div key={item.id} className="bg-white rounded-lg shadow-sm overflow-hidden"
                  style={{ border: '1px solid #e5e7eb', opacity: item.is_active ? 1 : 0.6 }}>
                  {/* Card body */}
                  <div className="flex items-start gap-3 p-4">
                    {/* Info */}
                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold" style={{ color: '#111827' }}>{item.name}</span>
                        {!item.is_active && (
                          <span className="text-xs font-medium px-1.5 py-0.5 rounded"
                            style={{ background: '#f3f4f6', color: '#9ca3af', border: '1px solid #e5e7eb' }}>
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className="text-2xl font-extrabold" style={{ color: '#1f2937' }}>{qtyDisplay}</span>
                        <span className="text-sm" style={{ color: '#9ca3af' }}>{item.unit}</span>
                        {item.reorder_level > 0 && (
                          <span className="text-xs" style={{ color: '#9ca3af' }}>
                            · alert at {item.reorder_level} {item.unit}
                          </span>
                        )}
                      </div>
                      {item.cost_per_unit > 0 && (
                        <p className="text-xs" style={{ color: '#9ca3af' }}>
                          ₱{item.cost_per_unit.toFixed(4)} / {item.unit}
                        </p>
                      )}
                    </div>
                    {/* Status badge */}
                    <div className="shrink-0 pt-0.5">
                      <span className="text-xs font-bold px-2 py-1 rounded"
                        style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}>
                        {sc.label}
                      </span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 px-4 pb-3">
                    <button type="button" onClick={() => openAdjust(item)}
                      className="px-4 py-1.5 rounded-md text-sm font-bold text-white"
                      style={{ background: isExpanded ? '#14532d' : '#166534' }}>
                      Adjust {isExpanded ? '▲' : '▼'}
                    </button>
                    {isAdmin && (
                      <button type="button" onClick={() => setView({ kind: 'editItem', id: item.id })}
                        className="px-4 py-1.5 rounded-md text-sm font-semibold"
                        style={{ border: '1px solid #e5e7eb', color: '#374151' }}>
                        Edit
                      </button>
                    )}
                  </div>

                  {/* Inline adjust dropdown */}
                  {isExpanded && (
                    <div className="p-4 flex flex-col gap-3"
                      style={{ borderTop: '1px solid #e5e7eb', background: '#f9fafb' }}>
                      <div>
                        <p className="text-sm font-semibold mb-0.5" style={{ color: '#374151' }}>Quantity Change</p>
                        <p className="text-xs mb-1.5" style={{ color: '#9ca3af' }}>Positive to add · Negative to subtract</p>
                        <input type="number" step="0.001" value={adjustDelta}
                          onChange={e => { setAdjustDelta(e.target.value); setAdjustError('') }}
                          placeholder="e.g. 50 or -10"
                          className="w-full rounded-md px-3 py-2 text-lg font-bold outline-none focus:ring-2 focus:ring-green-600"
                          style={{ border: '1.5px solid #d1d5db', color: '#111827', background: '#fff' }} />
                      </div>

                      <div>
                        <p className="text-sm font-semibold mb-1.5" style={{ color: '#374151' }}>Reason</p>
                        <div className="flex flex-col gap-1.5">
                          {REASONS.map(r => {
                            const sel = adjustReason === r
                            return (
                              <button key={r} type="button" onClick={() => setAdjustReason(r)}
                                className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left"
                                style={{
                                  border:     `1px solid ${sel ? '#166534' : '#e5e7eb'}`,
                                  background: sel ? '#f0fdf4' : '#fff',
                                  color:      sel ? '#15803d' : '#374151',
                                  fontWeight: sel ? '600'     : '400',
                                }}>
                                {/* Radio dot */}
                                <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0"
                                  style={{ border: `2px solid ${sel ? '#166534' : '#d1d5db'}`, background: sel ? '#166534' : 'transparent' }}>
                                  {sel && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                                </span>
                                {r}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      <div>
                        <p className="text-sm font-semibold mb-1" style={{ color: '#374151' }}>
                          Notes <span className="text-xs font-normal" style={{ color: '#9ca3af' }}>(optional)</span>
                        </p>
                        <textarea value={adjustNotes} onChange={e => setAdjustNotes(e.target.value)}
                          placeholder="e.g. Received from supplier"
                          rows={2} className="w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600 resize-none"
                          style={{ border: '1px solid #d1d5db', color: '#111827', background: '#fff' }} />
                      </div>

                      {adjustError && (
                        <div className="rounded-md px-3 py-2 text-sm"
                          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
                          {adjustError}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button type="button" onClick={() => setExpandedId(null)} disabled={adjusting}
                          className="flex-1 py-2 rounded-md text-sm font-semibold disabled:opacity-50"
                          style={{ border: '1px solid #e5e7eb', color: '#6b7280' }}>
                          Cancel
                        </button>
                        <button type="button" onClick={handleAdjust} disabled={adjusting}
                          className="flex-1 py-2 rounded-md text-sm font-bold text-white disabled:opacity-50"
                          style={{ background: '#166534' }}>
                          {adjusting ? 'Applying…' : 'Apply'}
                        </button>
                      </div>
                    </div>
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
