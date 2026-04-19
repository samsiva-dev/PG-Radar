'use client'

import { RawItem } from '@/types'
import { FeedCard } from './FeedCard'

interface PatchGroup {
  key:        string
  patch:      RawItem        // commitfest item that anchors the group
  related:    RawItem[]      // hackers/git items matching the patch by token overlap
}

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'by',
  'at', 'is', 'be', 'as', 'patch', 're', 'fwd', 'pgsql', 'postgresql', 'pg',
  '[patch]', '[committed]', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9',
  'wip', 'draft',
])

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/\[[^\]]*\]/g, ' ')        // strip [PATCH], [v3] etc
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOP.has(t))
  )
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0
  for (const t of a) if (b.has(t)) n++
  return n
}

function groupByPatch(items: RawItem[]): { groups: PatchGroup[]; orphans: RawItem[] } {
  const patches = items.filter(i => i.source === 'commitfest')
  const others  = items.filter(i => i.source !== 'commitfest')
  const used    = new Set<string>()
  const groups: PatchGroup[] = []

  for (const p of patches) {
    const ptoks = tokenize(p.title)
    if (ptoks.size === 0) {
      groups.push({ key: p.id, patch: p, related: [] })
      continue
    }

    const related: RawItem[] = []
    for (const o of others) {
      if (used.has(o.id)) continue
      const otoks = tokenize(o.title)
      if (overlap(ptoks, otoks) >= 2) {
        related.push(o)
        used.add(o.id)
      }
    }
    groups.push({ key: p.id, patch: p, related })
  }

  // Sort: groups with most related items first, then by patch date
  groups.sort((a, b) => {
    if (b.related.length !== a.related.length) return b.related.length - a.related.length
    return new Date(b.patch.publishedAt).getTime() - new Date(a.patch.publishedAt).getTime()
  })

  const orphans = others.filter(o => !used.has(o.id))
  return { groups, orphans }
}

export function PatchTracker({ items }: { items: RawItem[] }) {
  const { groups, orphans } = groupByPatch(items)

  if (groups.length === 0) {
    return (
      <div className="p-4 text-xs text-gray-500 dark:text-gray-400">
        No CommitFest patches in the current feed.
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-pg-blue dark:text-pg-sky">
        Patches ({groups.length})
      </h2>

      {groups.map(g => (
        <details key={g.key} open={g.related.length > 0} className="border border-pg-blue/10 dark:border-white/10 rounded-xl">
          <summary className="cursor-pointer px-3 py-2 flex items-center justify-between gap-2 list-none">
            <span className="text-sm font-medium flex-1">{g.patch.title.replace(/^\[CommitFest\]\s*/, '')}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-pg-amber/20 text-pg-amber">
              {g.related.length} related
            </span>
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-2">
            <FeedCard item={g.patch} />
            {g.related.length > 0 && (
              <div className="ml-4 border-l-2 border-pg-blue/10 pl-3 space-y-2">
                {g.related.map(r => <FeedCard key={r.id} item={r} />)}
              </div>
            )}
          </div>
        </details>
      ))}

      {orphans.length > 0 && (
        <details className="border border-pg-blue/10 dark:border-white/10 rounded-xl">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300">
            Other items ({orphans.length})
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-2">
            {orphans.map(o => <FeedCard key={o.id} item={o} />)}
          </div>
        </details>
      )}
    </div>
  )
}
