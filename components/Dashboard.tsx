'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { RawItem, InternalsTag } from '@/types'
import { detectTopics } from '@/lib/detectTopics'
import { FeedColumn } from './FeedColumn'
import { SourceFilter, SourceKey } from './SourceFilter'
import { TopicFilter } from './TopicFilter'
import { DigestBanner } from './DigestBanner'
import { PatchTracker } from './PatchTracker'
import { RangeSelector } from './RangeSelector'

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
    <header className="border-b border-pg-blue/10 bg-white dark:bg-pg-ink">
      {/* Row 1: brand + status + refresh */}
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center gap-1.5 text-base font-semibold tracking-tight text-pg-blue dark:text-pg-sky">
            <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-full bg-pg-blue dark:bg-pg-sky" />
            pg radar
          </span>
          <span className="hidden sm:inline-block text-[10px] sm:text-xs px-2 py-0.5 rounded-full bg-pg-blue/10 text-pg-blue dark:bg-pg-sky/15 dark:text-pg-sky whitespace-nowrap">
            PG18 watch
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 min-w-0">
          {phase === 'fetching' && (
            <span className="animate-pulse text-pg-blue dark:text-pg-sky truncate">
              <span className="hidden sm:inline">fetching sources…</span>
              <span className="sm:hidden">fetching…</span>
            </span>
          )}
          {phase === 'done' && cachedAt && (
            <span
              className="hidden sm:inline truncate"
              title={`Cached at ${new Date(cachedAt).toLocaleString()}`}
            >
              live · cached {formatRelativeShort(cachedAt)}
            </span>
          )}
          {errorSources.length > 0 && (
            <span
              className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 whitespace-nowrap"
              title={Object.entries(errors).map(([s, e]) => `${s}: ${e}`).join('\n')}
            >
              <span className="hidden sm:inline">{errorSources.length} source{errorSources.length > 1 ? 's' : ''} failed</span>
              <span className="sm:hidden">⚠ {errorSources.length}</span>
            </span>
          )}
          <button
            onClick={onRefresh}
            aria-label="Refresh feed"
            className="text-xs border border-pg-blue/30 dark:border-pg-sky/30 text-pg-blue dark:text-pg-sky rounded px-2 py-1 hover:bg-pg-blue/5 dark:hover:bg-pg-sky/10 transition-colors whitespace-nowrap"
          >
            <span className="hidden sm:inline">refresh</span>
            <span className="sm:hidden" aria-hidden>↻</span>
          </button>
        </div>
      </div>

      {/* Row 2: view toggle — full-width segmented control on mobile */}
      <div className="px-3 sm:px-4 pb-2 sm:pb-2.5 sm:-mt-1">
        <div className="flex w-full sm:w-auto sm:inline-flex rounded-md overflow-hidden border border-pg-blue/20 dark:border-pg-sky/20 text-xs">
          <button
            onClick={() => onView('feed')}
            className={`flex-1 sm:flex-none px-3 py-1 transition-colors ${view === 'feed' ? 'bg-pg-blue text-white dark:bg-pg-sky dark:text-pg-ink' : 'text-pg-blue dark:text-pg-sky hover:bg-pg-blue/10'}`}
          >
            feed
          </button>
          <button
            onClick={() => onView('patches')}
            className={`flex-1 sm:flex-none px-3 py-1 transition-colors ${view === 'patches' ? 'bg-pg-blue text-white dark:bg-pg-sky dark:text-pg-ink' : 'text-pg-blue dark:text-pg-sky hover:bg-pg-blue/10'}`}
          >
            patches
          </button>
        </div>
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
  const [active, setActive]           = useState<Set<SourceKey>>(new Set())
  const [activeTopics, setActiveTopics] = useState<Set<InternalsTag>>(new Set())
  const [view, setView]               = useState<View>('feed')
  const [days, setDays]               = useState<number>(7)
  const abortRef                = useRef<AbortController | null>(null)

  const loadFeed = useCallback(async (force = false, daysParam = days) => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    try {
      setPhase('fetching')
      const params = new URLSearchParams({ days: String(daysParam) })
      if (force) params.set('force', '1')
      const res = await fetch(`/api/feed?${params}`, { signal })
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
  }, [days])

  useEffect(() => {
    // Debounce when days changes via the number input
    const handle = setTimeout(() => loadFeed(false, days), 250)
    return () => {
      clearTimeout(handle)
      abortRef.current?.abort()
    }
  }, [loadFeed, days])

  // Stage 1: source filter
  const sourceFiltered = active.size === 0
    ? items
    : items.filter(i => active.has(i.source))

  // Precompute topic membership once per sourceFiltered change
  const topicMap = useMemo(() =>
    new Map(sourceFiltered.map(i => [i.id, detectTopics(i)])),
    [sourceFiltered]
  )

  // Stage 2: topic filter (OR logic across active topics)
  const filtered = activeTopics.size === 0
    ? sourceFiltered
    : sourceFiltered.filter(i => (topicMap.get(i.id) ?? []).some(t => activeTopics.has(t)))

  // Topic counts based on sourceFiltered (so counts stay stable as topics are toggled)
  const topicCounts = useMemo(() => {
    const counts: Partial<Record<InternalsTag, number>> = {}
    for (const [, tags] of topicMap) {
      for (const t of tags) counts[t] = (counts[t] ?? 0) + 1
    }
    return counts
  }, [topicMap])

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
      <RangeSelector value={days} onChange={setDays} />
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
      <TopicFilter
        active={activeTopics}
        counts={topicCounts}
        onToggle={(tag) => {
          setActiveTopics(prev => {
            const next = new Set(prev)
            if (next.has(tag)) next.delete(tag)
            else next.add(tag)
            return next
          })
        }}
        onClear={() => setActiveTopics(new Set())}
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
