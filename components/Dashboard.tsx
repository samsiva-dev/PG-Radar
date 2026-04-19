'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { RawItem } from '@/types'
import { FeedColumn } from './FeedColumn'
import { SourceFilter, SourceKey } from './SourceFilter'
import { DigestBanner } from './DigestBanner'
import { PatchTracker } from './PatchTracker'

type Phase = 'idle' | 'fetching' | 'done'
type View  = 'feed' | 'patches'

interface FeedResponse {
  items:    RawItem[]
  errors:   Record<string, string>
  cachedAt: string
  stale:    boolean
}

interface HeaderProps {
  phase:     Phase
  cachedAt:  string | null
  errors:    Record<string, string>
  view:      View
  onView:    (v: View) => void
  onRefresh: () => void
}

function Header({ phase, cachedAt, errors, view, onView, onRefresh }: HeaderProps) {
  const errorSources = Object.keys(errors)
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-pg-blue/10 bg-white dark:bg-pg-ink">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-base font-semibold tracking-tight text-pg-blue dark:text-pg-sky">
          <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-full bg-pg-blue dark:bg-pg-sky" />
          pg radar
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-pg-blue/10 text-pg-blue dark:bg-pg-sky/15 dark:text-pg-sky">
          PG18 watch
        </span>
        <div className="ml-2 flex rounded-md overflow-hidden border border-pg-blue/20 dark:border-pg-sky/20 text-xs">
          <button
            onClick={() => onView('feed')}
            className={`px-2 py-0.5 transition-colors ${view === 'feed' ? 'bg-pg-blue text-white dark:bg-pg-sky dark:text-pg-ink' : 'text-pg-blue dark:text-pg-sky hover:bg-pg-blue/10'}`}
          >
            feed
          </button>
          <button
            onClick={() => onView('patches')}
            className={`px-2 py-0.5 transition-colors ${view === 'patches' ? 'bg-pg-blue text-white dark:bg-pg-sky dark:text-pg-ink' : 'text-pg-blue dark:text-pg-sky hover:bg-pg-blue/10'}`}
          >
            patches
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        {phase === 'fetching' && (
          <span className="animate-pulse text-pg-blue dark:text-pg-sky">fetching sources…</span>
        )}
        {phase === 'done' && cachedAt && (
          <span title={`Cached at ${new Date(cachedAt).toLocaleString()}`}>
            live · cached {formatRelativeShort(cachedAt)}
          </span>
        )}
        {errorSources.length > 0 && (
          <span
            className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
            title={Object.entries(errors).map(([s, e]) => `${s}: ${e}`).join('\n')}
          >
            {errorSources.length} source{errorSources.length > 1 ? 's' : ''} failed
          </span>
        )}
        <button
          onClick={onRefresh}
          className="text-xs border border-pg-blue/30 dark:border-pg-sky/30 text-pg-blue dark:text-pg-sky rounded px-2 py-1 hover:bg-pg-blue/5 dark:hover:bg-pg-sky/10 transition-colors"
        >
          refresh
        </button>
      </div>
    </header>
  )
}

function formatRelativeShort(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

export function Dashboard() {
  const [items, setItems]       = useState<RawItem[]>([])
  const [errors, setErrors]     = useState<Record<string, string>>({})
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [phase, setPhase]       = useState<Phase>('idle')
  const [active, setActive]     = useState<Set<SourceKey>>(new Set())
  const [view, setView]         = useState<View>('feed')
  const abortRef                = useRef<AbortController | null>(null)

  const loadFeed = useCallback(async (force = false) => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    try {
      setPhase('fetching')
      const url = force ? '/api/feed?force=1' : '/api/feed'
      const res = await fetch(url, { signal })
      const data: FeedResponse = await res.json()
      setItems(data.items ?? [])
      setErrors(data.errors ?? {})
      setCachedAt(data.cachedAt ?? null)
      setPhase('done')
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Feed load error:', err)
        setPhase('done')
      }
    }
  }, [])

  useEffect(() => {
    loadFeed()
    return () => abortRef.current?.abort()
  }, [loadFeed])

  const filtered = active.size === 0
    ? items
    : items.filter(i => active.has(i.source))

  const mailingItems = filtered.filter(i => ['hackers', 'committers'].includes(i.source))
  const commitItems  = filtered.filter(i => ['git', 'github', 'commitfest', 'planet'].includes(i.source))

  return (
    <div className="min-h-screen bg-pg-paper dark:bg-pg-ink">
      <Header
        phase={phase}
        cachedAt={cachedAt}
        errors={errors}
        view={view}
        onView={setView}
        onRefresh={() => loadFeed(true)}
      />
      <DigestBanner items={items} />
      <SourceFilter
        active={active}
        counts={countBySource(items)}
        onToggle={(key) => {
          setActive(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
          })
        }}
        onClear={() => setActive(new Set())}
      />
      {view === 'feed' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-pg-blue/10">
          <FeedColumn label="mailing list · hackers" items={mailingItems} />
          <FeedColumn label="commits & patches"      items={commitItems} />
        </div>
      ) : (
        <PatchTracker items={filtered} />
      )}
    </div>
  )
}


function countBySource(items: RawItem[]): Record<SourceKey, number> {
  const counts = { hackers: 0, committers: 0, git: 0, github: 0, commitfest: 0, planet: 0 } as Record<SourceKey, number>
  for (const i of items) counts[i.source]++
  return counts
}
