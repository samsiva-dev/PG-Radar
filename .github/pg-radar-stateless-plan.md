# PostgreSQL Radar — stateless real-time dashboard

> No database. No cron. No server state.
> Fetches live from PostgreSQL community sources on every page load,
> streams Claude enrichment back to the browser progressively,
> caches in sessionStorage for the tab lifetime.

---

## Architecture in one sentence

Browser → `/api/feed` (proxy + RSS parse) → renders raw items immediately →
`/api/enrich` (Claude NDJSON stream) → cards update in place →
`sessionStorage` saves enriched results → next visit within same tab is instant.

---

## Project structure

```
pg-radar/
├── app/
│   ├── page.tsx                    # main dashboard, client component
│   ├── layout.tsx
│   └── api/
│       ├── feed/route.ts           # fetch + parse all RSS sources, return raw items
│       ├── enrich/route.ts         # stream Claude enrichment as NDJSON
│       └── thread/route.ts         # scrape full thread body on demand (on click)
├── components/
│   ├── Dashboard.tsx               # client root: orchestrates fetch + stream
│   ├── FeedColumn.tsx              # one column of cards (mailing list or commits)
│   ├── FeedCard.tsx                # single item card, handles raw → enriched transition
│   ├── FilterBar.tsx               # internals area chips
│   ├── ThreadDrawer.tsx            # slide-in panel for full thread body
│   └── StreamProgress.tsx          # "enriching 4/20..." status bar
├── lib/
│   ├── sources/
│   │   ├── rss.ts                  # generic RSS fetcher + parser
│   │   ├── hackers.ts              # pgsql-hackers RSS → RawItem[]
│   │   ├── committers.ts           # pgsql-committers RSS → RawItem[]
│   │   ├── git.ts                  # git.postgresql.org RSS → RawItem[]
│   │   ├── planet.ts               # planet.postgresql.org RSS → RawItem[]
│   │   └── commitfest.ts           # commitfest.postgresql.org JSON API
│   ├── session.ts                  # sessionStorage read/write helpers
│   └── profile.ts                  # your user profile constant for Claude
├── types.ts
├── next.config.ts
└── .env.local
```

---

## Core types

```typescript
// types.ts

export interface RawItem {
  id: string                   // sha256(source + guid/link)
  source: 'hackers' | 'committers' | 'git' | 'planet' | 'commitfest'
  title: string
  author: string
  publishedAt: string          // ISO string
  sourceUrl: string
  snippet: string              // first 800 chars of description/body from RSS
}

export interface EnrichedItem extends RawItem {
  summary: string              // 2-3 sentence plain-English summary
  internalsTag: InternalsTag
  pgVersion: 'PG18' | 'PG17' | null
  relevance: number            // 0–100
  relevanceReason: string      // one sentence, specific to your background
  enrichedAt: string
}

export type InternalsTag =
  | 'WAL' | 'MVCC' | 'planner' | 'executor'
  | 'buffer manager' | 'replication' | 'VACUUM'
  | 'lock manager' | 'memory' | 'storage'
  | 'parallel query' | 'partitioning' | 'AIO' | 'other'

export type ItemState = RawItem | EnrichedItem

export function isEnriched(item: ItemState): item is EnrichedItem {
  return 'summary' in item
}
```

---

## `/api/feed` — parallel source fetching

Fetches all sources in parallel, normalises to `RawItem[]`, returns JSON.
This route is the proxy — browser cannot fetch postgresql.org directly (CORS).

```typescript
// app/api/feed/route.ts

import { fetchHackers }     from '@/lib/sources/hackers'
import { fetchCommitters }  from '@/lib/sources/committers'
import { fetchGit }         from '@/lib/sources/git'
import { fetchPlanet }      from '@/lib/sources/planet'
import { fetchCommitFest }  from '@/lib/sources/commitfest'
import { NextResponse }     from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'  // never cache at CDN level

export async function GET() {
  const results = await Promise.allSettled([
    fetchHackers(),
    fetchCommitters(),
    fetchGit(),
    fetchPlanet(),
    fetchCommitFest(),
  ])

  const items = results
    .filter((r): r is PromiseFulfilledResult<RawItem[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)
    // sort newest first
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    // cap at 40 items total to keep enrichment cost reasonable
    .slice(0, 40)

  return NextResponse.json(items)
}
```

---

## RSS fetchers

All five sources follow the same pattern. Implement a generic RSS parser first, then each fetcher is just a URL + normalisation.

```typescript
// lib/sources/rss.ts

import { createHash } from 'crypto'

export interface RSSEntry {
  guid:        string
  title:       string
  link:        string
  author:      string
  pubDate:     string
  description: string
}

export async function fetchRSS(url: string): Promise<RSSEntry[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'pg-radar/1.0 (personal RSS reader)' },
    next: { revalidate: 0 },   // always fresh
  })
  const xml = await res.text()
  return parseRSS(xml)
}

function parseRSS(xml: string): RSSEntry[] {
  // Use a lightweight XML parser — recommend 'fast-xml-parser' or 'node-html-parser'
  // Extract all <item> elements, pull: title, link, author/dc:creator, pubDate, description
  // Strip HTML tags from description, truncate to 800 chars
  const entries: RSSEntry[] = []
  // ... parse logic ...
  return entries
}

export function makeItemId(source: string, guid: string): string {
  return createHash('sha256')
    .update(`${source}:${guid}`)
    .digest('hex')
    .slice(0, 16)
}
```

```typescript
// lib/sources/hackers.ts

export async function fetchHackers(): Promise<RawItem[]> {
  // pgsql-hackers RSS:
  // https://www.postgresql.org/list/pgsql-hackers/
  // Use the monthly archive RSS or the recent-messages feed:
  // https://www.postgresql.org/list/pgsql-hackers/since/2025-04-12T00:00:00+00:00/
  //
  // Each entry has message-id in the link — store it for thread scraping later

  const entries = await fetchRSS(
    'https://www.postgresql.org/list/pgsql-hackers/since/' +
    getSinceDate() + '/'
  )

  return entries.slice(0, 15).map(e => ({
    id:          makeItemId('hackers', e.guid),
    source:      'hackers',
    title:       e.title,
    author:      extractAuthor(e.author),
    publishedAt: new Date(e.pubDate).toISOString(),
    sourceUrl:   e.link,
    snippet:     stripQuotes(e.description).slice(0, 800),
  }))
}

function getSinceDate(): string {
  // fetch messages from past 3 days
  const d = new Date()
  d.setDate(d.getDate() - 3)
  return d.toISOString()
}

function stripQuotes(text: string): string {
  return text
    .split('\n')
    .filter(l => !l.trim().startsWith('>'))
    .join('\n')
    .trim()
}

function extractAuthor(raw: string): string {
  // RSS author field is often "email (Name)" or "Name <email>"
  const match = raw.match(/\((.+?)\)/) || raw.match(/^(.+?)\s*</)
  return match ? match[1].trim() : raw.trim()
}
```

```typescript
// lib/sources/git.ts

export async function fetchGit(): Promise<RawItem[]> {
  // git.postgresql.org RSS — recent commits to master + REL_17_STABLE:
  // https://git.postgresql.org/gitweb/?p=postgresql.git;a=rss

  const entries = await fetchRSS(
    'https://git.postgresql.org/gitweb/?p=postgresql.git;a=rss'
  )

  return entries.slice(0, 15).map(e => ({
    id:          makeItemId('git', e.guid),
    source:      'git',
    title:       e.title.replace(/^[a-f0-9]+ /, ''), // strip hash prefix
    author:      e.author,
    publishedAt: new Date(e.pubDate).toISOString(),
    sourceUrl:   e.link,
    snippet:     e.description.slice(0, 800),
  }))
}
```

```typescript
// lib/sources/commitfest.ts

export async function fetchCommitFest(): Promise<RawItem[]> {
  // CommitFest JSON API — active patches
  // https://commitfest.postgresql.org/patches/?format=json

  const data = await fetch(
    'https://commitfest.postgresql.org/patches/?format=json'
  ).then(r => r.json())

  // data is array of { id, name, status, author, target_version, last_updated_dt }
  // Filter for recently updated entries (last 7 days)
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000

  return data
    .filter((p: any) => new Date(p.last_updated_dt).getTime() > cutoff)
    .slice(0, 10)
    .map((p: any) => ({
      id:          makeItemId('commitfest', String(p.id)),
      source:      'commitfest',
      title:       `[CommitFest] ${p.name}`,
      author:      p.author ?? 'unknown',
      publishedAt: new Date(p.last_updated_dt).toISOString(),
      sourceUrl:   `https://commitfest.postgresql.org/patch/${p.id}/`,
      snippet:     `Status: ${p.status}. Target: ${p.target_version ?? 'unspecified'}.`,
    }))
}
```

---

## `/api/enrich` — NDJSON streaming enrichment

Takes raw items as POST body, calls Claude once per item, streams each enriched result back as newline-delimited JSON. The browser reads this stream and updates cards as each line arrives.

```typescript
// app/api/enrich/route.ts

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Your personal profile — edit this as your focus evolves
const PROFILE = `
PostgreSQL internals engineer, 3 years at a distributed database company built on PostgreSQL.
Deep hands-on experience with: WAL internals, MVCC visibility rules, buffer manager (LWLock
strategies, shared_buffers), lock manager, VACUUM (freeze, visibility map), memory contexts
(TransactionMemoryContext, TopMemoryContext), CustomScan nodes, Tuplestore buffering,
executor hooks, planner hooks, TupleTableSlot evolution (PG12→PG18), logical replication.

Work stories: COPY framework with LZ4/SCP compression, Blue-Green zero-downtime migration
PG11→PG17, cursor-based distributed pagination, three transactional consistency modes,
TransactionMemoryContext bug fix, distributed architecture via CustomScan + Tuplestore.

Currently studying: PG18 AIO subsystem (per-worker I/O contexts, async read paths),
parallel query internals, Nile-style tenant isolation at the page level.

Low relevance: Windows-specific patches, contrib extensions unrelated to core,
client library changes, documentation-only commits.
`

const SYSTEM = `You are a PostgreSQL internals expert assistant.
Given a raw feed item, produce a JSON object with these exact fields:
{
  "summary": "2–3 sentences, plain English. What problem does it solve? Why does it matter?",
  "internalsTag": one of: WAL|MVCC|planner|executor|buffer manager|replication|VACUUM|lock manager|memory|storage|parallel query|partitioning|AIO|other,
  "pgVersion": "PG18"|"PG17"|null,
  "relevance": integer 0–100 against the user profile,
  "relevanceReason": "one sentence, specific — reference their actual work areas if relevant, or explain why it's not relevant"
}
Return only the JSON object. No markdown fences, no preamble.

User profile:
${PROFILE}`

export async function POST(req: Request) {
  const items: RawItem[] = await req.json()

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      for (const item of items) {
        try {
          const response = await client.messages.create({
            model:      'claude-haiku-4-5-20251001',
            max_tokens: 350,
            system:     SYSTEM,
            messages:   [{
              role:    'user',
              content: `Source: ${item.source}\nTitle: ${item.title}\nAuthor: ${item.author}\nDate: ${item.publishedAt}\n\n${item.snippet}`,
            }],
          })

          const text = (response.content[0] as any).text as string
          const enriched = JSON.parse(text)

          // Emit one line of NDJSON: { id, ...enrichedFields }
          const line = JSON.stringify({ id: item.id, ...enriched, enrichedAt: new Date().toISOString() }) + '\n'
          controller.enqueue(encoder.encode(line))
        } catch (err) {
          // Emit error marker so browser can skip this item gracefully
          const errLine = JSON.stringify({ id: item.id, error: true }) + '\n'
          controller.enqueue(encoder.encode(errLine))
        }
      }
      controller.close()
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'application/x-ndjson',
      'Cache-Control': 'no-store',
    }
  })
}
```

---

## `/api/thread` — scrape full thread on click

Only fires when user clicks a mailing list card to expand it.

```typescript
// app/api/thread/route.ts

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const messageId = searchParams.get('messageId') // extracted from sourceUrl

  if (!messageId) return new Response('missing messageId', { status: 400 })

  // Full thread view:
  // https://www.postgresql.org/message-id/flat/<message-id>
  // Returns an HTML page with the full thread, all replies

  const res = await fetch(
    `https://www.postgresql.org/message-id/flat/${encodeURIComponent(messageId)}`,
    { headers: { 'User-Agent': 'pg-radar/1.0' } }
  )
  const html = await res.text()

  // Parse: extract each message in thread
  // Each message: author, date, body (strip quoted text and footer)
  const messages = parseThreadHtml(html)

  return Response.json({ messages })
}

function parseThreadHtml(html: string): ThreadMessage[] {
  // The flat view renders messages as <div class="message"> blocks
  // Each has: .from, .date, .body
  // Use node-html-parser or cheerio to extract
  // Strip standard PG mailing list footer from each body
  // Return array of { author, date, body } — max 20 messages
  return []
}
```

---

## sessionStorage cache helpers

```typescript
// lib/session.ts

const CACHE_VERSION = 'v1'
const SESSION_KEY   = (source: string) => `pg-radar-${CACHE_VERSION}-${source}`
const FULL_KEY      = `pg-radar-${CACHE_VERSION}-all`

export interface SessionCache {
  fetchedAt: string
  items:     EnrichedItem[]
}

export function getCached(): SessionCache | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(FULL_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setCached(items: EnrichedItem[]): void {
  if (typeof window === 'undefined') return
  try {
    const cache: SessionCache = { fetchedAt: new Date().toISOString(), items }
    sessionStorage.setItem(FULL_KEY, JSON.stringify(cache))
  } catch {
    // sessionStorage quota exceeded — silently skip
  }
}

export function updateCachedItem(id: string, enriched: Partial<EnrichedItem>): void {
  const cache = getCached()
  if (!cache) return
  cache.items = cache.items.map(item =>
    item.id === id ? { ...item, ...enriched } : item
  )
  setCached(cache.items)
}

export function clearCache(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem(FULL_KEY)
}
```

---

## Dashboard client component — the orchestrator

```typescript
// components/Dashboard.tsx
'use client'

import { useState, useEffect, useRef } from 'react'
import { getCached, setCached, updateCachedItem } from '@/lib/session'

export function Dashboard() {
  const [items, setItems]         = useState<ItemState[]>([])
  const [phase, setPhase]         = useState<'idle' | 'fetching' | 'enriching' | 'done'>('idle')
  const [enrichedCount, setEnrichedCount] = useState(0)
  const [activeFilter, setActiveFilter]   = useState<InternalsTag | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const cached = getCached()
    if (cached) {
      // Session hit — render immediately, skip all network calls
      setItems(cached.items)
      setPhase('done')
      setEnrichedCount(cached.items.length)
      return
    }
    loadFeed()

    return () => abortRef.current?.abort()
  }, [])

  async function loadFeed() {
    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    // Phase 1: fetch raw items
    setPhase('fetching')
    const res  = await fetch('/api/feed', { signal })
    const raw: RawItem[] = await res.json()
    setItems(raw)

    // Phase 2: stream enrichment
    setPhase('enriching')
    const enrichRes = await fetch('/api/enrich', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(raw),
      signal,
    })

    const reader  = enrichRes.body!.getReader()
    const decoder = new TextDecoder()
    let   buffer  = ''
    const enriched: Record<string, EnrichedItem> = {}

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''   // incomplete last line goes back to buffer

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line)
          if (data.error) continue  // skip failed enrichments

          // Merge enrichment into existing raw item
          setItems(prev => prev.map(item =>
            item.id === data.id ? { ...item, ...data } : item
          ))
          setEnrichedCount(c => c + 1)

          // Track for session cache
          enriched[data.id] = data
        } catch { /* malformed line — skip */ }
      }
    }

    // Save fully enriched set to sessionStorage
    const finalItems = raw.map(item =>
      enriched[item.id] ? { ...item, ...enriched[item.id] } : item
    ) as EnrichedItem[]
    setCached(finalItems)
    setPhase('done')
  }

  const filtered = activeFilter
    ? items.filter(i => isEnriched(i) && i.internalsTag === activeFilter)
    : items

  const mailingItems = filtered.filter(i =>
    ['hackers', 'committers'].includes(i.source)
  )
  const commitItems = filtered.filter(i =>
    ['git', 'commitfest', 'planet'].includes(i.source)
  )

  return (
    <div>
      <Header phase={phase} enrichedCount={enrichedCount} total={items.length} onRefresh={() => {
        clearCache()
        setItems([])
        setPhase('idle')
        setEnrichedCount(0)
        loadFeed()
      }} />
      <FilterBar active={activeFilter} onChange={setActiveFilter} />
      <div className="grid grid-cols-1 md:grid-cols-2 divide-x divide-gray-100 dark:divide-gray-800">
        <FeedColumn label="mailing list · hackers" items={mailingItems} />
        <FeedColumn label="committed patches" items={commitItems} />
      </div>
    </div>
  )
}
```

---

## FeedCard — handles raw → enriched transition

```tsx
// components/FeedCard.tsx
'use client'

import { useState } from 'react'

const TAG_STYLES: Record<string, string> = {
  'WAL':            'bg-purple-50 text-purple-800 dark:bg-purple-950 dark:text-purple-200',
  'MVCC':           'bg-teal-50   text-teal-800   dark:bg-teal-950   dark:text-teal-200',
  'planner':        'bg-amber-50  text-amber-800  dark:bg-amber-950  dark:text-amber-200',
  'executor':       'bg-amber-50  text-amber-800  dark:bg-amber-950  dark:text-amber-200',
  'buffer manager': 'bg-orange-50 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  'replication':    'bg-pink-50   text-pink-800   dark:bg-pink-950   dark:text-pink-200',
  'VACUUM':         'bg-green-50  text-green-800  dark:bg-green-950  dark:text-green-200',
  'lock manager':   'bg-blue-50   text-blue-800   dark:bg-blue-950   dark:text-blue-200',
  'AIO':            'bg-red-50    text-red-800    dark:bg-red-950    dark:text-red-200',
  'memory':         'bg-slate-50  text-slate-800  dark:bg-slate-900  dark:text-slate-200',
}

export function FeedCard({ item }: { item: ItemState }) {
  const [expanded, setExpanded] = useState(false)
  const [thread, setThread]     = useState<ThreadMessage[] | null>(null)
  const [loadingThread, setLoadingThread] = useState(false)

  const rich = isEnriched(item)

  async function handleExpand() {
    setExpanded(e => !e)
    if (thread || !item.sourceUrl.includes('message-id')) return

    setLoadingThread(true)
    const messageId = extractMessageId(item.sourceUrl)
    const res = await fetch(`/api/thread?messageId=${encodeURIComponent(messageId)}`)
    const data = await res.json()
    setThread(data.messages)
    setLoadingThread(false)
  }

  return (
    <article
      className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-3 mb-2 cursor-pointer hover:border-gray-200 dark:hover:border-gray-700 transition-colors"
      onClick={handleExpand}
    >
      {/* Header row */}
      <div className="flex items-start gap-2 mb-2">
        <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${SOURCE_DOT[item.source]}`} />
        <h3 className="text-sm font-medium leading-snug flex-1">{item.title}</h3>
      </div>

      {/* Tags — only when enriched */}
      {rich && (
        <div className="flex gap-1.5 mb-2 flex-wrap">
          <span className={`text-xs px-2 py-0.5 rounded ${TAG_STYLES[item.internalsTag] ?? 'bg-gray-50 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
            {item.internalsTag}
          </span>
          {item.pgVersion && (
            <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200">
              {item.pgVersion}
            </span>
          )}
        </div>
      )}

      {/* Summary — skeleton while enriching */}
      {rich ? (
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-2">
          {item.summary}
        </p>
      ) : (
        <div className="space-y-1.5 mb-2">
          <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded animate-pulse w-4/5" />
          <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded animate-pulse w-3/5" />
        </div>
      )}

      {/* Relevance reason — only when relevant */}
      {rich && item.relevance >= 40 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 italic mb-2">
          {item.relevanceReason}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {item.author} · {formatRelativeDate(item.publishedAt)}
        </span>
        {rich && item.relevance >= 70 && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300">
            high relevance
          </span>
        )}
        {rich && item.relevance >= 40 && item.relevance < 70 && (
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300">
            medium
          </span>
        )}
      </div>

      {/* Expanded: full thread */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
          {loadingThread && (
            <p className="text-xs text-gray-400 animate-pulse">loading thread…</p>
          )}
          {thread && thread.map((msg, i) => (
            <div key={i} className="mb-3 text-xs">
              <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">
                {msg.author} · {formatRelativeDate(msg.date)}
              </div>
              <p className="text-gray-500 dark:text-gray-400 leading-relaxed whitespace-pre-wrap">
                {msg.body.slice(0, 600)}{msg.body.length > 600 ? '…' : ''}
              </p>
            </div>
          ))}
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline"
            onClick={e => e.stopPropagation()}
          >
            open on postgresql.org →
          </a>
        </div>
      )}
    </article>
  )
}

const SOURCE_DOT: Record<string, string> = {
  hackers:    'bg-purple-400',
  committers: 'bg-teal-400',
  git:        'bg-teal-500',
  commitfest: 'bg-amber-400',
  planet:     'bg-gray-400',
}

function extractMessageId(url: string): string {
  // https://www.postgresql.org/message-id/flat/CAA4eK1K...@mail.gmail.com
  // → CAA4eK1K...@mail.gmail.com
  return url.split('/message-id/').pop()?.replace('flat/', '') ?? ''
}
```

---

## Header with status + refresh

```tsx
// In Dashboard.tsx — inline header component

function Header({ phase, enrichedCount, total, onRefresh }: HeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">pg radar</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200">
          PG18 watch
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-400">
        {phase === 'fetching' && <span className="animate-pulse">fetching sources…</span>}
        {phase === 'enriching' && (
          <span className="animate-pulse">
            enriching {enrichedCount}/{total}…
          </span>
        )}
        {phase === 'done' && <span>live · tab cached</span>}
        <button
          onClick={onRefresh}
          className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          refresh
        </button>
      </div>
    </header>
  )
}
```

---

## Environment + bootstrap

```bash
# .env.local
ANTHROPIC_API_KEY=sk-ant-...
```

```bash
# bootstrap
npx create-next-app@latest pg-radar --typescript --tailwind --app
cd pg-radar
npm install @anthropic-ai/sdk fast-xml-parser node-html-parser
npm run dev
```

---

## Sprint order for Claude Code

1. Bootstrap Next.js + Tailwind, verify dev server runs
2. Implement `lib/sources/rss.ts` — generic `fetchRSS()` + `parseRSS()` with `fast-xml-parser`
3. Implement `lib/sources/git.ts` — parse git.postgresql.org RSS, test in isolation
4. Implement `lib/sources/planet.ts` — parse Planet PostgreSQL RSS
5. Implement `lib/sources/hackers.ts` — pgsql-hackers recent-messages feed
6. Implement `lib/sources/committers.ts` — pgsql-committers RSS
7. Implement `lib/sources/commitfest.ts` — JSON API fetch
8. Implement `app/api/feed/route.ts` — parallel fetch, normalise, return JSON
9. Test `/api/feed` in browser — verify real items come back
10. Implement `app/api/enrich/route.ts` — NDJSON stream, test with 3 items first
11. Implement `lib/session.ts` — `getCached`, `setCached`, `updateCachedItem`
12. Implement `Dashboard.tsx` — fetch phase, render raw items, no enrichment yet
13. Wire NDJSON reader in `Dashboard.tsx` — update cards as stream arrives
14. Implement `lib/session.ts` save at end of stream — verify tab cache works
15. Implement `FeedCard.tsx` — raw skeleton + enriched transition + tag styles
16. Implement `FilterBar.tsx` — chips filter `activeFilter` state
17. Implement `app/api/thread/route.ts` — scrape flat thread HTML
18. Wire thread expand in `FeedCard.tsx` — click → fetch → render messages
19. Polish: refresh button clears cache + reloads, header status text, dark mode check

---

## Cost estimate

Using `claude-haiku-4-5-20251001` for enrichment:
- 40 items × ~400 input tokens + ~200 output tokens = ~24,000 tokens per session
- At Haiku pricing (~$0.25/MTok input, $1.25/MTok output): roughly **$0.006 per full page load**
- With sessionStorage cache: cost is zero for all subsequent visits in the same tab

Refresh button fires a fresh enrichment cycle — use it intentionally, not compulsively.

---

*No database. No cron. Just your browser, the PostgreSQL community, and Claude.*
