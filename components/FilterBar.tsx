'use client'

import { InternalsTag } from '@/types'

const ALL_TAGS: InternalsTag[] = [
  'WAL', 'MVCC', 'planner', 'executor', 'buffer manager',
  'replication', 'VACUUM', 'lock manager', 'memory', 'storage',
  'parallel query', 'partitioning', 'AIO', 'other'
]

interface FilterBarProps {
  active: InternalsTag | null
  onChange: (tag: InternalsTag | null) => void
}

export function FilterBar({ active, onChange }: FilterBarProps) {
  return (
    <div className="flex flex-wrap gap-1.5 px-4 py-2.5 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950 overflow-x-auto">
      <button
        onClick={() => onChange(null)}
        className={`text-xs px-2.5 py-1 rounded-full transition-colors whitespace-nowrap ${
          active === null
            ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
        }`}
      >
        all
      </button>
      {ALL_TAGS.map(tag => (
        <button
          key={tag}
          onClick={() => onChange(active === tag ? null : tag)}
          className={`text-xs px-2.5 py-1 rounded-full transition-colors whitespace-nowrap ${
            active === tag
              ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}
        >
          {tag}
        </button>
      ))}
    </div>
  )
}
