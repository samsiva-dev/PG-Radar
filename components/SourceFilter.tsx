'use client'

import { RawItem } from '@/types'

export type SourceKey = RawItem['source']

const SOURCES: { key: SourceKey; label: string; color: string }[] = [
  { key: 'hackers',    label: 'pgsql-hackers',    color: 'bg-pg-purple  text-white' },
  { key: 'committers', label: 'pgsql-committers',  color: 'bg-pg-teal   text-white' },
  { key: 'git',        label: 'git commits',       color: 'bg-pg-teal   text-white' },
  { key: 'github',     label: 'github',             color: 'bg-pg-blue   text-white' },
  { key: 'commitfest', label: 'commitfest',         color: 'bg-pg-amber  text-white' },
  { key: 'planet',     label: 'planet.pg.org',      color: 'bg-gray-500  text-white' },
]

interface SourceFilterProps {
  active:   Set<SourceKey>
  counts:   Record<SourceKey, number>
  onToggle: (key: SourceKey) => void
  onClear:  () => void
}

export function SourceFilter({ active, counts, onToggle, onClear }: SourceFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-pg-blue/10 bg-white dark:bg-pg-ink">
      {active.size > 0 && (
        <button
          onClick={onClear}
          className="text-xs px-2.5 py-1 rounded-full border border-pg-blue/30 text-pg-blue dark:text-pg-sky hover:bg-pg-blue/5 dark:hover:bg-pg-sky/10 transition-colors whitespace-nowrap"
        >
          ✕ clear
        </button>
      )}
      {SOURCES.map(({ key, label, color }) => {
        const isActive = active.has(key)
        const count    = counts[key] ?? 0
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              isActive
                ? color
                : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20'
            }`}
          >
            {label}
            <span className={`inline-flex items-center justify-center w-4 h-4 text-[10px] rounded-full font-medium ${
              isActive ? 'bg-white/20' : 'bg-gray-300/60 dark:bg-white/20 text-gray-700 dark:text-gray-200'
            }`}>
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
