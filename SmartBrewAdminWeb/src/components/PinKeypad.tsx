interface Props {
  value: string
  onChange: (val: string) => void
}

const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'] as const

export default function PinKeypad({ value, onChange }: Props) {
  function press(key: string) {
    if (key === '⌫') { onChange(value.slice(0, -1)); return }
    onChange(value + key)
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Dots display */}
      <div className="flex gap-3 min-h-[24px] items-center">
        {value.length === 0
          ? <span className="text-sm" style={{ color: '#9ca3af' }}>Enter PIN</span>
          : Array.from(value).map((_, i) => (
              <span key={i} style={{ fontSize: 22, lineHeight: 1, color: '#166534' }}>●</span>
            ))
        }
      </div>

      {/* Grid */}
      <div className="grid grid-cols-3 gap-2 w-full" style={{ maxWidth: 256 }}>
        {KEYS.map((key, i) =>
          key === ''
            ? <div key={i} />
            : <button
                key={i}
                type="button"
                onClick={() => press(key)}
                className="flex items-center justify-center rounded-xl text-lg font-semibold transition-all active:scale-95"
                style={{
                  height: 56,
                  background: key === '⌫' ? 'rgba(220,38,38,0.07)' : '#f0fdf4',
                  color:      key === '⌫' ? '#dc2626' : '#166534',
                  border:     `1px solid ${key === '⌫' ? 'rgba(220,38,38,0.2)' : '#bbf7d0'}`,
                }}
              >
                {key}
              </button>
        )}
      </div>
    </div>
  )
}
