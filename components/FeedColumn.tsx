'use client'

import { RawItem } from '@/types'
import { FeedCard } from './FeedCard'

interface FeedColumnProps {
  label: string
  items: RawItem[]
}

export function FeedColumn({ label, items }: FeedColumnProps) {
  return (
    <div className="p-4">
      <h2 className="text-xs font-semibold text-pg-blue/60 dark:text-pg-sky/60 uppercase tracking-wider mb-3">
        {label}
        <span className="ml-2 font-normal normal-case tracking-normal text-pg-blue/30 dark:text-pg-sky/30">
          {items.length}
        </span>
      </h2>
      {items.length === 0 ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-white/5 border border-pg-blue/10 dark:border-white/10 rounded-xl p-3">
              <div className="flex gap-2 mb-2">
                <div className="mt-1.5 w-2 h-2 rounded-full bg-pg-blue/20 dark:bg-pg-sky/20 flex-shrink-0" />
                <div className="h-3 bg-pg-blue/10 dark:bg-white/10 rounded animate-pulse flex-1" />
              </div>
              <div className="space-y-1.5">
                <div className="h-2 bg-pg-blue/10 dark:bg-white/10 rounded animate-pulse w-4/5" />
                <div className="h-2 bg-pg-blue/10 dark:bg-white/10 rounded animate-pulse w-3/5" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>
          {items.map(item => (
            <FeedCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
