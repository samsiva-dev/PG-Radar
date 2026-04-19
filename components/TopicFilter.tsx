'use client'

import { InternalsTag } from '@/types'
import { TOPIC_LIST } from '@/lib/detectTopics'

interface TopicFilterProps {
  active:   Set<InternalsTag>
  counts:   Partial<Record<InternalsTag, number>>
  onToggle: (tag: InternalsTag) => void
  onClear:  () => void
}

export function TopicFilter({ active, counts, onToggle, onClear }: TopicFilterProps) {
  // Only show topics that appear at least once in the current item set
  const visible = TOPIC_LIST.filter(t => (counts[t.tag] ?? 0) > 0)
  if (visible.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 border-b border-pg-blue/10 bg-white dark:bg-pg-ink overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mr-1">
        topic:
      </span>

      {active.size > 0 && (
        <button
          onClick={onClear}
          className="text-xs px-2 py-0.5 rounded-full border border-pg-blue/30 text-pg-blue dark:text-pg-sky hover:bg-pg-blue/5 dark:hover:bg-pg-sky/10 transition-colors whitespace-nowrap"
        >
          ✕ clear
        </button>
      )}

      {visible.map(({ tag, label, color }) => {
        const isActive = active.has(tag)
        const count    = counts[tag] ?? 0
        return (
          <button
            key={tag}
            onClick={() => onToggle(tag)}
            className={`text-xs px-2.5 py-0.5 rounded-full transition-colors whitespace-nowrap flex items-center gap-1 ${
              isActive
                ? `${color} text-white`
                : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20'
            }`}
          >
            {label}
            <span className={`inline-flex items-center justify-center min-w-[16px] h-4 px-0.5 text-[10px] rounded-full font-medium ${
              isActive ? 'bg-white/25' : 'bg-gray-300/60 dark:bg-white/20 text-gray-700 dark:text-gray-200'
            }`}>
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
