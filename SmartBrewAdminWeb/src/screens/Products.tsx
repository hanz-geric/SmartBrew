import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getDocs, setDoc, addDoc, deleteDoc, doc, query, orderBy,
} from 'firebase/firestore'
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '@/firebase/config'
import { productsCol, categoriesCol, modGroupsCol, stockCol } from '@/firebase/collections'
import { useAuth } from '@/context/AuthContext'
import AppLayout from '@/components/AppLayout'
import type { Category, ModifierGroup, Product, RecipeLine, StockItem, TrackingMode } from '@/types'

// ─── View discriminant ────────────────────────────────────────────────────────

type View =
  | { kind: 'list' }
  | { kind: 'editProduct';  id: string | null }
  | { kind: 'editCategory'; id: string | null }

// ─── Data helpers ─────────────────────────────────────────────────────────────

async function fetchAll() {
  const [prodSnap, catSnap, modSnap, stockSnap] = await Promise.all([
    getDocs(productsCol()),
    getDocs(query(categoriesCol(), orderBy('sort_order'))),
    getDocs(modGroupsCol()),
    getDocs(stockCol()),
  ])
  const products = prodSnap.docs.map(d => ({
    id: d.id,
    ...(d.data() as Omit<Product, 'id'>),
    stock_status:    (d.data().stock_status    ?? 'ok') as Product['stock_status'],
    modifier_groups: (d.data().modifier_groups ?? [])   as Product['modifier_groups'],
    recipe_lines:    (d.data().recipe_lines    ?? [])   as Product['recipe_lines'],
  })).sort((a, b) => a.name.localeCompare(b.name))

  const categories = catSnap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Category, 'id'>) }))
  const modGroups  = modSnap.docs
    .map(d => ({ id: d.id, ...(d.data() as Omit<ModifierGroup, 'id'>) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const stockItems = stockSnap.docs
    .map(d => ({ id: d.id, ...(d.data() as Omit<StockItem, 'id'>) }))
    .filter(s => s.is_active)
  return { products, categories, modGroups, stockItems }
}

async function uploadProductImage(file: File, productId: string): Promise<string> {
  const r = sRef(storage, `products/${productId}.jpg`)
  await uploadBytes(r, file, { contentType: file.type || 'image/jpeg' })
  return getDownloadURL(r)
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

function Field({ label, hint, required, children }: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <span className="text-sm font-semibold" style={{ color: '#374151' }}>{label}</span>
        {required && <span className="text-sm" style={{ color: '#dc2626' }}>*</span>}
      </div>
      {hint && <p className="text-xs" style={{ color: '#9ca3af' }}>{hint}</p>}
      {children}
    </div>
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

function SectionLabel({ title }: { title: string }) {
  return (
    <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#9ca3af' }}>
      {title}
    </p>
  )
}

function inputCls() {
  return 'w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600'
}

// ─── CategoryEditForm ─────────────────────────────────────────────────────────

function CategoryEditForm({
  categories, editId, onBack, onSaved,
}: {
  categories: Category[]
  editId:     string | null
  onBack:     () => void
  onSaved:    () => void
}) {
  const isNew    = editId === null
  const existing = editId ? categories.find(c => c.id === editId) : null

  const [name,      setName]      = useState(existing?.name       ?? '')
  const [sortOrder, setSortOrder] = useState(String(existing?.sort_order ?? 0))
  const [isActive,  setIsActive]  = useState(existing?.is_active  ?? true)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  async function handleSave() {
    const trimmed = name.trim()
    const sortNum = parseInt(sortOrder, 10)
    if (!trimmed)                        { setError('Name is required.'); return }
    if (isNaN(sortNum) || sortNum < 0)   { setError('Sort order must be 0 or higher.'); return }
    setSaving(true); setError('')
    try {
      const data: Omit<Category, 'id'> = { name: trimmed, sort_order: sortNum, is_active: isActive }
      if (editId) {
        await setDoc(doc(db, 'categories', editId), data, { merge: true })
      } else {
        await addDoc(categoriesCol(), data)
      }
      onSaved()
    } catch (e: unknown) {
      setError((e as { code?: string }).code === 'permission-denied' ? 'Permission denied.' : 'Failed to save.')
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
        {isNew ? 'New Category' : 'Edit Category'}
      </h1>

      <div className="bg-white rounded-lg p-5 flex flex-col gap-5" style={{ border: '1px solid #e5e7eb' }}>
        <Field label="Category Name" required>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Hot Drinks" className={inputCls()}
            style={{ border: '1px solid #d1d5db', color: '#111827' }} />
        </Field>

        <Field label="Sort Order" hint="Lower numbers appear first in the POS">
          <input type="number" min="0" value={sortOrder} onChange={e => setSortOrder(e.target.value)}
            placeholder="0" className="w-28 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600"
            style={{ border: '1px solid #d1d5db', color: '#111827' }} />
        </Field>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold" style={{ color: '#374151' }}>Active</p>
            <p className="text-xs" style={{ color: '#9ca3af' }}>Inactive categories are hidden from the POS</p>
          </div>
          <Toggle value={isActive} onChange={setIsActive} />
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg px-3 py-2 text-sm"
          style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
          {error}
        </div>
      )}

      <div className="flex gap-3 mt-5">
        <button onClick={onBack} className="px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ border: '1px solid #e5e7eb', color: '#374151' }}>Cancel</button>
        <button onClick={handleSave} disabled={saving}
          className="px-6 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: '#166534' }}>
          {saving ? 'Saving…' : isNew ? 'Create' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

// ─── ProductEditForm ──────────────────────────────────────────────────────────

function ProductEditForm({
  editId, categories, modGroups, stockItems, onBack, onSaved,
}: {
  editId:     string | null
  categories: Category[]
  modGroups:  ModifierGroup[]
  stockItems: StockItem[]
  onBack:     () => void
  onSaved:    () => void
}) {
  const isNew = editId === null

  const [loading,     setLoading]     = useState(!isNew)
  const [saving,      setSaving]      = useState(false)
  const [deleting,    setDeleting]    = useState(false)
  const [error,       setError]       = useState('')
  const [deleteModal, setDeleteModal] = useState(false)

  const [name,           setName]           = useState('')
  const [description,    setDescription]    = useState('')
  const [price,          setPrice]          = useState('')
  const [cost,           setCost]           = useState('')
  const [catIds,         setCatIds]         = useState<string[]>(
    categories.length > 0 ? [categories[0].id] : [],
  )
  const [trackingMode,   setTrackingMode]   = useState<TrackingMode>('recipe')
  const [needsKitchen,   setNeedsKitchen]   = useState(false)
  const [isActive,       setIsActive]       = useState(true)
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])
  const [stockItemId,    setStockItemId]    = useState<string | null>(null)
  const [recipeLines,    setRecipeLines]    = useState<RecipeLine[]>([])
  const [imageUrl,       setImageUrl]       = useState<string | null>(null)
  const [imageFile,      setImageFile]      = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-calc cost from recipe ingredients
  useEffect(() => {
    if (trackingMode !== 'recipe') return
    const total = recipeLines.reduce((sum, line) => {
      const item = stockItems.find(s => s.id === line.stock_item_id)
      return sum + (item?.cost_per_unit ?? 0) * (line.quantity_required || 0)
    }, 0)
    setCost(total.toFixed(4))
  }, [recipeLines, stockItems, trackingMode])

  // Load existing product
  useEffect(() => {
    if (isNew) return
    async function loadProduct() {
      try {
        const snap = await getDocs(productsCol())
        const raw  = snap.docs.find(d => d.id === editId)
        if (!raw) { setError('Product not found.'); return }
        const p: Product = {
          id: raw.id,
          ...(raw.data() as Omit<Product, 'id'>),
          stock_status:    (raw.data().stock_status    ?? 'ok') as Product['stock_status'],
          modifier_groups: (raw.data().modifier_groups ?? [])   as Product['modifier_groups'],
          recipe_lines:    (raw.data().recipe_lines    ?? [])   as Product['recipe_lines'],
        }
        setName(p.name)
        setDescription(p.description ?? '')
        setPrice(String(p.price))
        setCost(String(p.cost))
        setCatIds(p.category_ids ?? [p.category_id])
        setTrackingMode(p.tracking_mode)
        setStockItemId(p.stock_item_id)
        setNeedsKitchen(p.needs_kitchen)
        setIsActive(p.is_active)
        setSelectedGroups(p.modifier_groups.map(g => g.id))
        setImageUrl(p.image ?? null)
        setRecipeLines(p.recipe_lines ?? [])
      } catch {
        setError('Failed to load product.')
      } finally {
        setLoading(false)
      }
    }
    loadProduct()
  }, [editId, isNew])

  async function handleSave() {
    setError('')
    const trimmed  = name.trim()
    const priceNum = parseFloat(price)
    const costNum  = parseFloat(cost) || 0
    if (!trimmed)                        { setError('Name is required.'); return }
    if (isNaN(priceNum) || priceNum < 0) { setError('Enter a valid price.'); return }
    if (costNum < 0)                     { setError('Cost cannot be negative.'); return }
    if (catIds.length === 0)             { setError('Select at least one category.'); return }
    if (trackingMode === 'direct' && !stockItemId) {
      setError('Select a linked stock item for direct tracking.'); return
    }
    if (trackingMode === 'recipe' && recipeLines.length === 0) {
      setError('Add at least one ingredient for recipe tracking.'); return
    }
    if (trackingMode === 'recipe' && recipeLines.some(l => !l.stock_item_id || l.quantity_required <= 0)) {
      setError('Each ingredient needs a stock item and a quantity greater than 0.'); return
    }

    const primaryCatId = catIds[0]
    const selectedCat  = categories.find(c => c.id === primaryCatId)
    const builtGroups  = modGroups
      .filter(g => selectedGroups.includes(g.id))
      .map(g => ({ id: g.id, name: g.name, is_required: g.is_required, max_select: g.max_select, modifiers: g.modifiers }))

    setSaving(true)
    try {
      const baseData = {
        name:            trimmed,
        description:     description.trim() || undefined,
        price:           priceNum,
        cost:            costNum,
        category_id:     primaryCatId,
        category_ids:    catIds,
        category_name:   selectedCat?.name ?? '',
        tracking_mode:   trackingMode,
        stock_item_id:   trackingMode === 'direct' ? (stockItemId ?? null) : null,
        recipe_lines:    trackingMode === 'recipe' ? recipeLines : [],
        needs_kitchen:   needsKitchen,
        is_active:       isActive,
        modifier_groups: builtGroups,
      } as Omit<Product, 'id' | 'stock_status'>

      let finalImage = imageUrl
      if (imageFile) {
        // For new products: create the doc first to get an ID, then upload under that ID
        const targetId = editId != null ? editId : await addDoc(productsCol(), { ...baseData, image: null }).then(r => r.id)
        finalImage = await uploadProductImage(imageFile, targetId)
        await setDoc(doc(db, 'products', targetId), { ...baseData, image: finalImage }, { merge: true })
      } else if (editId) {
        await setDoc(doc(db, 'products', editId), { ...baseData, image: finalImage }, { merge: true })
      } else {
        await addDoc(productsCol(), { ...baseData, image: finalImage })
      }
      onSaved()
    } catch (e: unknown) {
      const code = (e as { code?: string }).code ?? ''
      setError(
        code === 'permission-denied' || code === 'storage/unauthorized'
          ? 'Permission denied.'
          : (e as Error).message
            ? `Save failed: ${(e as Error).message}`
            : 'Failed to save.',
      )
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    if (!editId) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'products', editId))
      onSaved()
    } catch (e: unknown) {
      setError((e as { code?: string }).code === 'permission-denied' ? 'Permission denied.' : 'Failed to delete.')
      setDeleting(false)
    }
  }

  const imagePreview = imageFile ? URL.createObjectURL(imageFile) : imageUrl

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-sm" style={{ color: '#9ca3af' }}>Loading…</span>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <button onClick={onBack} className="text-sm font-medium mb-2 block" style={{ color: '#15803d' }}>
        ‹ Back
      </button>
      <h1 className="text-xl font-bold mb-6" style={{ color: '#111827' }}>
        {isNew ? 'New Product' : 'Edit Product'}
      </h1>

      {/* ── Product Image ── */}
      <div className="mb-6">
        <SectionLabel title="Product Image" />
        <div className="bg-white rounded-lg p-4 flex items-center gap-5" style={{ border: '1px solid #e5e7eb' }}>
          <div
            className="w-24 h-24 rounded-lg overflow-hidden flex items-center justify-center shrink-0 cursor-pointer"
            style={{ border: '1.5px solid #e5e7eb', background: '#f0fdf4' }}
            onClick={() => fileInputRef.current?.click()}
          >
            {imagePreview
              ? <img src={imagePreview} alt="Product" className="w-full h-full object-cover" />
              : <span className="text-4xl">☕</span>
            }
          </div>
          <div className="flex flex-col gap-2">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) setImageFile(f); e.target.value = '' }} />
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-md text-sm font-semibold"
              style={{ border: '1.5px solid #16a34a', color: '#15803d' }}>
              {imagePreview ? 'Change Image' : 'Upload Image'}
            </button>
            {imagePreview && (
              <button type="button" onClick={() => { setImageFile(null); setImageUrl(null) }}
                className="px-3 py-1.5 rounded-md text-sm font-semibold"
                style={{ border: '1.5px solid #dc2626', color: '#dc2626' }}>
                Remove
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Product Info ── */}
      <div className="mb-6">
        <SectionLabel title="Product Info" />
        <div className="bg-white rounded-lg p-5 flex flex-col gap-4" style={{ border: '1px solid #e5e7eb' }}>
          <Field label="Name" required>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Caramel Latte" className={inputCls()}
              style={{ border: '1px solid #d1d5db', color: '#111827' }} />
          </Field>

          <Field label="Description" hint="Optional — appears on receipt and kitchen ticket">
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Includes: Pancakes, Coffee, Orange Juice" rows={2}
              className="w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600 resize-none"
              style={{ border: '1px solid #d1d5db', color: '#111827' }} />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Selling Price (₱)" required>
              <input type="number" min="0" step="0.01" value={price}
                onChange={e => setPrice(e.target.value)} placeholder="0.00"
                className={inputCls()} style={{ border: '1px solid #d1d5db', color: '#111827' }} />
            </Field>
            <Field label={trackingMode === 'recipe' ? 'Cost ₱ (auto)' : 'Cost (₱)'}
              hint="Used for profit reporting">
              <input type="number" min="0" step="0.0001" value={cost}
                onChange={e => setCost(e.target.value)} placeholder="0.00"
                readOnly={trackingMode === 'recipe'}
                className={inputCls()}
                style={{
                  border:     '1px solid #d1d5db',
                  color:      trackingMode === 'recipe' ? '#9ca3af' : '#111827',
                  background: trackingMode === 'recipe' ? '#f3f4f6' : '#fff',
                }} />
            </Field>
          </div>

          <Field label="Category" required hint="Select one or more (e.g. Hot & Cold)">
            <div className="flex flex-wrap gap-2 mt-1">
              {categories.map(cat => {
                const sel = catIds.includes(cat.id)
                return (
                  <button key={cat.id} type="button"
                    onClick={() => setCatIds(prev =>
                      prev.includes(cat.id) ? prev.filter(x => x !== cat.id) : [...prev, cat.id],
                    )}
                    className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                    style={{
                      border:     `1.5px solid ${sel ? '#166534' : '#e5e7eb'}`,
                      background: sel ? '#f0fdf4' : '#fff',
                      color:      sel ? '#15803d' : '#6b7280',
                    }}>
                    {cat.name}
                  </button>
                )
              })}
              {categories.length === 0 && (
                <p className="text-sm" style={{ color: '#9ca3af' }}>No categories. Create one first.</p>
              )}
            </div>
          </Field>
        </div>
      </div>

      {/* ── Options ── */}
      <div className="mb-6">
        <SectionLabel title="Options" />
        <div className="bg-white rounded-lg p-5 flex flex-col gap-5" style={{ border: '1px solid #e5e7eb' }}>
          {/* Kitchen toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold" style={{ color: '#374151' }}>Needs Kitchen Ticket</p>
              <p className="text-xs" style={{ color: '#9ca3af' }}>Send this item to the kitchen printer when ordered</p>
            </div>
            <Toggle value={needsKitchen} onChange={setNeedsKitchen} />
          </div>

          {/* Stock tracking mode */}
          <Field label="Stock Tracking" hint="How this product's inventory is tracked">
            <div className="flex flex-wrap gap-2 mt-1">
              {([
                ['none',   'None',         'No tracking'],
                ['direct', 'Direct',       'Track stock directly on this product'],
                ['recipe', 'Recipe-based', 'Deduct from ingredient stock items'],
              ] as [TrackingMode, string, string][]).map(([val, label, hint]) => {
                const sel = trackingMode === val
                return (
                  <button key={val} type="button" onClick={() => setTrackingMode(val)}
                    className="flex flex-col px-3 py-2 rounded-md text-left"
                    style={{
                      border:     `1.5px solid ${sel ? '#166534' : '#e5e7eb'}`,
                      background: sel ? '#f0fdf4' : '#fff',
                      minWidth:   110,
                    }}>
                    <span className="text-sm font-medium" style={{ color: sel ? '#15803d' : '#374151' }}>{label}</span>
                    <span className="text-xs" style={{ color: sel ? '#16a34a' : '#9ca3af' }}>{hint}</span>
                  </button>
                )
              })}
            </div>
          </Field>

          {/* Direct: linked stock item picker */}
          {trackingMode === 'direct' && (
            <Field label="Linked Stock Item" required>
              {stockItems.length === 0
                ? <p className="text-sm" style={{ color: '#9ca3af' }}>No active stock items. Create one in Stock Management.</p>
                : (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {stockItems.map(item => {
                      const sel = stockItemId === item.id
                      return (
                        <button key={item.id} type="button" onClick={() => setStockItemId(item.id)}
                          className="flex flex-col px-3 py-1.5 rounded-md text-left"
                          style={{ border: `1.5px solid ${sel ? '#166534' : '#e5e7eb'}`, background: sel ? '#f0fdf4' : '#fff' }}>
                          <span className="text-sm font-medium" style={{ color: sel ? '#15803d' : '#374151' }}>{item.name}</span>
                          <span className="text-xs" style={{ color: '#9ca3af' }}>{item.quantity_on_hand} {item.unit} on hand</span>
                        </button>
                      )
                    })}
                  </div>
                )
              }
            </Field>
          )}

          {/* Recipe: ingredient builder */}
          {trackingMode === 'recipe' && (
            <Field label="Recipe Ingredients" required hint="What is consumed when 1 unit is sold">
              {stockItems.length === 0
                ? <p className="text-sm" style={{ color: '#9ca3af' }}>No active stock items. Create some in Stock Management first.</p>
                : (
                  <div className="flex flex-col gap-3 mt-1">
                    {recipeLines.map((line, idx) => {
                      const linked = stockItems.find(s => s.id === line.stock_item_id)
                      return (
                        <div key={idx} className="rounded-md p-3 flex flex-col gap-2"
                          style={{ border: '1.5px solid #e5e7eb' }}>
                          {/* Stock item chips */}
                          <div className="flex flex-wrap gap-1.5">
                            {stockItems.map(si => {
                              const sel = line.stock_item_id === si.id
                              return (
                                <button key={si.id} type="button"
                                  onClick={() => {
                                    const u = [...recipeLines]
                                    u[idx] = { ...u[idx], stock_item_id: si.id }
                                    setRecipeLines(u)
                                  }}
                                  className="px-2 py-1 rounded-md text-xs font-medium"
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
                              onChange={e => {
                                const u = [...recipeLines]
                                u[idx] = { ...u[idx], quantity_required: parseFloat(e.target.value) || 0 }
                                setRecipeLines(u)
                              }}
                              placeholder="Qty"
                              className="w-20 rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-green-600"
                              style={{ border: '1px solid #d1d5db' }} />
                            <span className="text-sm flex-1" style={{ color: '#6b7280' }}>{linked?.unit ?? '—'}</span>
                            <button type="button"
                              onClick={() => setRecipeLines(recipeLines.filter((_, i) => i !== idx))}
                              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                              style={{ background: '#f3f4f6', color: '#6b7280' }}>
                              ✕
                            </button>
                          </div>
                        </div>
                      )
                    })}
                    <button type="button"
                      onClick={() => setRecipeLines([...recipeLines, { stock_item_id: '', quantity_required: 0 }])}
                      className="py-2 rounded-md text-sm font-semibold"
                      style={{ border: '1.5px dashed #16a34a', color: '#15803d' }}>
                      + Add Ingredient
                    </button>
                  </div>
                )
              }
            </Field>
          )}

          {/* Active toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold" style={{ color: '#374151' }}>Active</p>
              <p className="text-xs" style={{ color: '#9ca3af' }}>Inactive products are hidden from the POS</p>
            </div>
            <Toggle value={isActive} onChange={setIsActive} />
          </div>
        </div>
      </div>

      {/* ── Modifier Groups ── */}
      <div className="mb-6">
        <SectionLabel title="Modifier Groups" />
        <div className="bg-white rounded-lg p-5 flex flex-col gap-2" style={{ border: '1px solid #e5e7eb' }}>
          {modGroups.length === 0
            ? <p className="text-sm" style={{ color: '#9ca3af' }}>No modifier groups defined in the database.</p>
            : modGroups.map(g => {
                const sel = selectedGroups.includes(g.id)
                return (
                  <div key={g.id}
                    className="flex items-center gap-3 p-3 rounded-md cursor-pointer"
                    style={{ border: `1.5px solid ${sel ? '#166534' : '#e5e7eb'}`, background: sel ? '#f0fdf4' : '#fff' }}
                    onClick={() => setSelectedGroups(prev =>
                      prev.includes(g.id) ? prev.filter(x => x !== g.id) : [...prev, g.id],
                    )}>
                    <div className="w-5 h-5 rounded flex items-center justify-center shrink-0"
                      style={{ border: `1.5px solid ${sel ? '#166534' : '#d1d5db'}`, background: sel ? '#166534' : '#fff' }}>
                      {sel && <span className="text-xs font-bold text-white">✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: sel ? '#15803d' : '#374151' }}>{g.name}</p>
                      <p className="text-xs" style={{ color: '#9ca3af' }}>
                        {g.is_required ? 'Required' : 'Optional'} · max {g.max_select} · {g.modifiers.length} option{g.modifiers.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                )
              })
          }
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
      <button type="button" onClick={handleSave} disabled={saving}
        className="w-full py-3 rounded-lg text-sm font-bold text-white disabled:opacity-50 mb-6"
        style={{ background: '#166534' }}>
        {saving ? 'Saving…' : isNew ? 'Create Product' : 'Save Changes'}
      </button>

      {/* ── Danger Zone (edit only) ── */}
      {!isNew && (
        <div className="mb-6">
          <SectionLabel title="Danger Zone" />
          <div className="bg-white rounded-lg p-5 flex flex-col gap-4" style={{ border: '1px solid #e5e7eb' }}>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold" style={{ color: '#111827' }}>
                  {isActive ? 'Product is Active' : 'Product is Inactive'}
                </p>
                <p className="text-xs" style={{ color: '#6b7280' }}>
                  {isActive
                    ? 'Deactivating hides it from the POS. Orders are unaffected.'
                    : 'Activating makes it visible in the POS again.'}
                </p>
              </div>
              <button type="button" onClick={() => setIsActive(v => !v)}
                className="px-3 py-1.5 rounded-md text-sm font-bold shrink-0"
                style={{
                  border:     `1.5px solid ${isActive ? '#dc2626' : '#166534'}`,
                  color:      isActive ? '#dc2626' : '#15803d',
                  background: isActive ? '#fef2f2' : '#f0fdf4',
                }}>
                {isActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
            <div className="border-t" style={{ borderColor: '#f3f4f6' }} />
            <div>
              <p className="text-sm mb-3" style={{ color: '#6b7280' }}>
                Deleting permanently removes this product from the menu. All past orders that included it are preserved.
              </p>
              <button type="button" onClick={() => setDeleteModal(true)} disabled={saving || deleting}
                className="px-4 py-2 rounded-md text-sm font-semibold disabled:opacity-50"
                style={{ border: '1.5px solid #dc2626', color: '#dc2626' }}>
                {deleting ? 'Deleting…' : 'Delete Product'}
              </button>
            </div>
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
            <h2 className="text-base font-bold mb-1" style={{ color: '#111827' }}>Delete Product</h2>
            <p className="text-sm mb-5" style={{ color: '#6b7280' }}>
              Permanently delete "{name}"? This cannot be undone. All past orders are preserved.
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

// ─── Products (main) ──────────────────────────────────────────────────────────

export default function Products() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [products,   setProducts]   = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [modGroups,  setModGroups]  = useState<ModifierGroup[]>([])
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [loading,    setLoading]    = useState(true)
  const [tab,        setTab]        = useState<'products' | 'categories'>('products')
  const [view,       setView]       = useState<View>({ kind: 'list' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAll()
      setProducts(data.products)
      setCategories(data.categories)
      setModGroups(data.modGroups)
      setStockItems(data.stockItems)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function handleSaved() {
    setView({ kind: 'list' })
    load()
  }

  // ── Product edit ─────────────────────────────────────────────────────────────
  if (view.kind === 'editProduct') {
    return (
      <AppLayout>
        <div className="overflow-y-auto" style={{ background: '#f9fafb', minHeight: '100%' }}>
          <ProductEditForm
            editId={view.id}
            categories={categories}
            modGroups={modGroups}
            stockItems={stockItems}
            onBack={() => setView({ kind: 'list' })}
            onSaved={handleSaved}
          />
        </div>
      </AppLayout>
    )
  }

  // ── Category edit ────────────────────────────────────────────────────────────
  if (view.kind === 'editCategory') {
    return (
      <AppLayout>
        <div className="overflow-y-auto" style={{ background: '#f9fafb', minHeight: '100%' }}>
          <CategoryEditForm
            categories={categories}
            editId={view.id}
            onBack={() => setView({ kind: 'list' })}
            onSaved={handleSaved}
          />
        </div>
      </AppLayout>
    )
  }

  // ── List view ────────────────────────────────────────────────────────────────

  // Products grouped by category
  const grouped = categories.map(cat => ({
    cat,
    items: products.filter(p => (p.category_ids ?? [p.category_id]).includes(cat.id)),
  })).filter(g => g.items.length > 0)

  const uncategorised = products.filter(
    p => !categories.some(c => (p.category_ids ?? [p.category_id]).includes(c.id)),
  )

  const activeTab = isAdmin ? tab : 'categories'

  return (
    <AppLayout>
      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 bg-white" style={{ borderBottom: '1px solid #e5e7eb' }}>
        <div className="flex items-center justify-between px-6 py-4">
          <h1 className="text-xl font-bold" style={{ color: '#111827' }}>Menu Management</h1>
          <div className="flex items-center gap-2">
            <button onClick={load} disabled={loading}
              className="px-3 py-1 rounded-md text-sm font-semibold disabled:opacity-50"
              style={{ border: '1px solid #e5e7eb', color: '#15803d' }}>
              {loading ? '…' : '↻ Refresh'}
            </button>
            <button
              onClick={() => setView(activeTab === 'products'
                ? { kind: 'editProduct',  id: null }
                : { kind: 'editCategory', id: null },
              )}
              className="px-4 py-2 rounded-lg text-sm font-bold text-white"
              style={{ background: '#166534' }}>
              + Add {activeTab === 'products' ? 'Product' : 'Category'}
            </button>
          </div>
        </div>

        {/* Tabs — admin sees both */}
        {isAdmin && (
          <div className="flex gap-2 px-6 pb-3">
            {(['products', 'categories'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="px-4 py-1.5 rounded-md text-sm font-medium transition-colors"
                style={{
                  border:     `1.5px solid ${tab === t ? '#166534' : '#e5e7eb'}`,
                  background: tab === t ? '#f0fdf4' : '#fff',
                  color:      tab === t ? '#15803d' : '#6b7280',
                  fontWeight: tab === t ? '700' : '500',
                }}>
                {t === 'products'
                  ? `Products (${products.length})`
                  : `Categories (${categories.length})`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="p-6" style={{ background: '#f9fafb', minHeight: '100%' }}>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <span className="text-sm" style={{ color: '#9ca3af' }}>Loading…</span>
          </div>
        ) : activeTab === 'products' ? (
          /* ── Products list ── */
          grouped.length === 0 && uncategorised.length === 0 ? (
            <p className="text-center py-20 text-sm" style={{ color: '#9ca3af' }}>
              No products yet. Click "+ Add Product" to create one.
            </p>
          ) : (
            <div className="flex flex-col gap-6 max-w-3xl mx-auto">
              {grouped.map(({ cat, items }) => (
                <div key={cat.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#9ca3af' }}>
                      {cat.name}
                    </span>
                    {!cat.is_active && <Badge label="Inactive" color="#9ca3af" />}
                  </div>
                  <div className="flex flex-col gap-2">
                    {items.map(p => (
                      <div key={p.id}
                        className="bg-white rounded-lg px-4 py-3 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow shadow-sm"
                        style={{ border: '1px solid #e5e7eb' }}
                        onClick={() => setView({ kind: 'editProduct', id: p.id })}>
                        {p.image && (
                          <img src={p.image} alt={p.name}
                            className="w-10 h-10 rounded-md object-cover shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold" style={{ color: '#111827' }}>{p.name}</span>
                            {!p.is_active     && <Badge label="Inactive" color="#9ca3af" />}
                            {p.needs_kitchen  && <Badge label="Kitchen"  color="#854d0e" />}
                          </div>
                          {p.modifier_groups.length > 0 && (
                            <p className="text-xs mt-0.5" style={{ color: '#9ca3af' }}>
                              {p.modifier_groups.length} modifier group{p.modifier_groups.length > 1 ? 's' : ''}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-bold" style={{ color: '#111827' }}>₱{p.price.toFixed(2)}</p>
                          <p className="text-xs" style={{ color: '#9ca3af' }}>cost ₱{p.cost.toFixed(2)}</p>
                        </div>
                        <span className="text-lg" style={{ color: '#d1d5db' }}>›</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {uncategorised.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#9ca3af' }}>
                    Uncategorised
                  </p>
                  <div className="flex flex-col gap-2">
                    {uncategorised.map(p => (
                      <div key={p.id}
                        className="bg-white rounded-lg px-4 py-3 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow shadow-sm"
                        style={{ border: '1px solid #e5e7eb' }}
                        onClick={() => setView({ kind: 'editProduct', id: p.id })}>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-semibold" style={{ color: '#111827' }}>{p.name}</span>
                        </div>
                        <p className="text-sm font-bold shrink-0" style={{ color: '#111827' }}>₱{p.price.toFixed(2)}</p>
                        <span className="text-lg" style={{ color: '#d1d5db' }}>›</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        ) : (
          /* ── Categories list ── */
          categories.length === 0 ? (
            <p className="text-center py-20 text-sm" style={{ color: '#9ca3af' }}>
              No categories yet. Click "+ Add Category" to create one.
            </p>
          ) : (
            <div className="flex flex-col gap-2 max-w-3xl mx-auto">
              {categories.map(cat => {
                const count = products.filter(p => (p.category_ids ?? [p.category_id]).includes(cat.id)).length
                return (
                  <div key={cat.id}
                    className="bg-white rounded-lg px-4 py-3 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow shadow-sm"
                    style={{ border: '1px solid #e5e7eb' }}
                    onClick={() => setView({ kind: 'editCategory', id: cat.id })}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold" style={{ color: '#111827' }}>{cat.name}</span>
                        {!cat.is_active && <Badge label="Inactive" color="#9ca3af" />}
                      </div>
                      <p className="text-xs mt-0.5" style={{ color: '#9ca3af' }}>
                        {count} product{count !== 1 ? 's' : ''} · order #{cat.sort_order}
                      </p>
                    </div>
                    <span className="text-lg" style={{ color: '#d1d5db' }}>›</span>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>
    </AppLayout>
  )
}
