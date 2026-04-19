'use client'

const PRESETS: { days: number; label: string }[] = [
  { days: 1,   label: '1d' },
  { days: 3,   label: '3d' },
  { days: 7,   label: '7d' },
  { days: 14,  label: '2w' },
  { days: 30,  label: '1m' },
  { days: 90,  label: '3m' },
  { days: 180, label: '6m' },
  { days: 365, label: '1y' },
]

interface RangeSelectorProps {
  value:    number
  onChange: (days: number) => void
}

export function RangeSelector({ value, onChange }: RangeSelectorProps) {
  const isPreset = PRESETS.some(p => p.days === value)
  return (
    <div className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 border-b border-pg-blue/10 bg-white dark:bg-pg-ink overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mr-1">
        range:
      </span>
      {PRESETS.map(p => (
        <button
          key={p.days}
          onClick={() => onChange(p.days)}
          className={`text-xs px-2 py-0.5 rounded-full transition-colors whitespace-nowrap ${
            value === p.days
              ? 'bg-pg-blue text-white dark:bg-pg-sky dark:text-pg-ink'
              : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300 hover:bg-pg-blue/10'
          }`}
        >
          {p.label}
        </button>
      ))}
      <label className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 ml-1">
        <span className="hidden sm:inline">custom:</span>
        <input
          type="number"
          min={1}
          max={365}
          value={value}
          onChange={e => {
            const n = Math.max(1, Math.min(365, Number(e.target.value) || 1))
            onChange(n)
          }}
          className={`w-14 px-1.5 py-0.5 text-xs rounded border bg-transparent text-right ${
            isPreset
              ? 'border-pg-blue/20 dark:border-white/10 text-gray-500 dark:text-gray-400'
              : 'border-pg-blue/40 dark:border-pg-sky/40 text-pg-blue dark:text-pg-sky'
          }`}
        />
        <span className="text-[10px]">days</span>
      </label>
    </div>
  )
}
