import { useEffect, useState } from 'react'
import { getDoc, setDoc } from 'firebase/firestore'
import { settingsDoc } from '@/firebase/collections'
import AppLayout from '@/components/AppLayout'
import type { Settings } from '@/types'

// ─── Receipt preview ─────────────────────────────────────────────────────────

const W = 32

function center(s: string): string {
  if (s.length >= W) return s.slice(0, W)
  const pad = Math.floor((W - s.length) / 2)
  return ' '.repeat(pad) + s
}

function ReceiptPreview({ name, address, phone, footer }: {
  name: string; address: string; phone: string; footer: string
}) {
  const div = '─'.repeat(W)
  const dbl = '═'.repeat(W)
  const n   = name    || 'Your Business Name'
  const f   = footer  || 'Thank you for your order!'
  const today = new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })

  const lines = [
    dbl,
    center(n),
    ...(address ? [center(address)] : []),
    ...(phone   ? [center(phone)]   : []),
    div,
    `Order #0001              ${today}`,
    `1x Caramel Latte         ₱150.00`,
    div,
    `              TOTAL:     ₱150.00`,
    dbl,
    center(f),
    dbl,
  ]

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#9ca3af' }}>
        Receipt Preview
      </p>
      <div className="bg-white rounded-lg p-4" style={{ border: '1px solid #e5e7eb' }}>
        <pre
          className="overflow-x-auto rounded p-3 text-xs leading-relaxed"
          style={{
            fontFamily: '"Courier New", Courier, monospace',
            background: '#fafaf8',
            border:     '1px solid #e5e7eb',
            color:      '#1f2937',
            fontSize:   '11px',
          }}>
          {lines.join('\n')}
        </pre>
      </div>
    </div>
  )
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

async function loadSettings(): Promise<Settings> {
  const snap = await getDoc(settingsDoc())
  if (!snap.exists()) return {}
  const d = snap.data()
  return {
    business_name:    d.business_name    ?? undefined,
    business_address: d.business_address ?? undefined,
    business_phone:   d.business_phone   ?? undefined,
    receipt_footer:   d.receipt_footer   ?? undefined,
  }
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState('')

  const [bizName,    setBizName]    = useState('')
  const [bizAddress, setBizAddress] = useState('')
  const [bizPhone,   setBizPhone]   = useState('')
  const [footer,     setFooter]     = useState('')

  function applySettings(s: Settings) {
    setBizName(s.business_name    ?? '')
    setBizAddress(s.business_address ?? '')
    setBizPhone(s.business_phone   ?? '')
    setFooter(s.receipt_footer   ?? '')
  }

  async function load() {
    setLoading(true)
    setError('')
    try {
      applySettings(await loadSettings())
    } catch {
      setError('Failed to load settings.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError('')
    const data: Settings = {
      business_name:    bizName.trim()    || undefined,
      business_address: bizAddress.trim() || undefined,
      business_phone:   bizPhone.trim()   || undefined,
      receipt_footer:   footer.trim()     || undefined,
    }
    try {
      await setDoc(settingsDoc(), data, { merge: true })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      const code = (e as { code?: string }).code ?? ''
      setError(code === 'permission-denied' ? 'Permission denied.' : 'Failed to save. Check your connection.')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600'
  const inputStyle = { border: '1px solid #d1d5db', color: '#111827' }

  return (
    <AppLayout>
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white" style={{ borderBottom: '1px solid #e5e7eb' }}>
        <div className="flex items-center justify-between px-6 py-4 flex-wrap gap-3">
          <h1 className="text-xl font-bold" style={{ color: '#111827' }}>Settings</h1>
          <div className="flex items-center gap-3 flex-wrap">
            {saved && (
              <span className="text-sm font-semibold" style={{ color: '#15803d' }}>✓ Saved</span>
            )}
            {error && (
              <span className="text-sm px-2 py-1 rounded"
                style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid rgba(220,38,38,0.2)' }}>
                {error}
              </span>
            )}
            <button onClick={load} disabled={saving || loading}
              className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
              style={{ border: '1.5px solid #e5e7eb', color: '#374151' }}>
              Discard Changes
            </button>
            <button onClick={handleSave} disabled={saving || loading}
              className="px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50"
              style={{ background: '#166534' }}>
              {saving ? 'Saving…' : 'Save Changes'}
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
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl mx-auto items-start">

            {/* ── Left: form ── */}
            <div className="flex flex-col gap-6">

              {/* Business Info */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#9ca3af' }}>
                  Business Info
                </p>
                <div className="bg-white rounded-lg p-5 flex flex-col gap-4"
                  style={{ border: '1px solid #e5e7eb' }}>

                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold" style={{ color: '#374151' }}>Business Name</span>
                    <input type="text" value={bizName} onChange={e => setBizName(e.target.value)}
                      placeholder="SmartBrew Café"
                      className={inputCls} style={inputStyle} />
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold" style={{ color: '#374151' }}>Address</span>
                    <input type="text" value={bizAddress} onChange={e => setBizAddress(e.target.value)}
                      placeholder="123 Main St, City"
                      className={inputCls} style={inputStyle} />
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold" style={{ color: '#374151' }}>Phone</span>
                    <input type="tel" value={bizPhone} onChange={e => setBizPhone(e.target.value)}
                      placeholder="+63 900 000 0000"
                      className={inputCls} style={inputStyle} />
                  </div>
                </div>
              </div>

              {/* Receipt */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: '#9ca3af' }}>
                  Receipt
                </p>
                <div className="bg-white rounded-lg p-5"
                  style={{ border: '1px solid #e5e7eb' }}>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold" style={{ color: '#374151' }}>Footer Text</span>
                    <p className="text-xs" style={{ color: '#9ca3af' }}>Printed at the bottom of every receipt.</p>
                    <textarea value={footer} onChange={e => setFooter(e.target.value)}
                      placeholder="Thank you for visiting!"
                      rows={3}
                      className="w-full rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-600 resize-none"
                      style={inputStyle} />
                  </div>
                </div>
              </div>

            </div>

            {/* ── Right: live preview ── */}
            <div className="lg:sticky lg:top-24">
              <ReceiptPreview
                name={bizName}
                address={bizAddress}
                phone={bizPhone}
                footer={footer}
              />
            </div>

          </div>
        )}
      </div>
    </AppLayout>
  )
}
