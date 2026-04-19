import { fetchHackers }     from '@/lib/sources/hackers'
import { fetchCommitters }  from '@/lib/sources/committers'
import { fetchGit }         from '@/lib/sources/git'
import { fetchPlanet }      from '@/lib/sources/planet'
import { fetchCommitFest }  from '@/lib/sources/commitfest'
import { fetchGitHub }      from '@/lib/sources/github'
import { NextResponse }     from 'next/server'
import { RawItem }          from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 10 * 60 * 1000  // 10 minutes
const DEFAULT_DAYS = 7
const MIN_DAYS     = 1
const MAX_DAYS     = 365

interface CachedFeed {
  fetchedAt: number
  days:      number
  items:     RawItem[]
  errors:    Record<string, string>
}

const cache = new Map<number, CachedFeed>()
const inflight = new Map<number, Promise<CachedFeed>>()

function clampDays(raw: string | null): number {
  const n = Number(raw ?? DEFAULT_DAYS)
  if (!Number.isFinite(n)) return DEFAULT_DAYS
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.round(n)))
}

async function buildFeed(days: number): Promise<CachedFeed> {
  const sources = [
    { name: 'hackers',    fn: () => fetchHackers(days) },
    { name: 'committers', fn: () => fetchCommitters(days) },
    { name: 'git',        fn: () => fetchGit() },
    { name: 'github',     fn: () => fetchGitHub() },
    { name: 'planet',     fn: () => fetchPlanet() },
    { name: 'commitfest', fn: () => fetchCommitFest() },
  ] as const

  const results = await Promise.allSettled(sources.map(s => s.fn()))

  const errors: Record<string, string> = {}
  const items: RawItem[] = []

  results.forEach((r, i) => {
    const sourceName = sources[i].name
    if (r.status === 'fulfilled') {
      items.push(...r.value)
    } else {
      errors[sourceName] = r.reason instanceof Error ? r.reason.message : String(r.reason)
      console.error(`[feed] source ${sourceName} (days=${days}) failed:`, r.reason)
    }
  })

  // Filter by the requested time window — sources that return latest-N
  // (git, github, commitfest, planet) get clipped here for short windows,
  // and naturally span longer windows on their own.
  // Align to midnight (same as getSinceDateCompact) so mailing-list items
  // stamped at 00:00 of the since-date are never clipped by a sub-day gap.
  const cutoffDate = new Date()
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days)
  cutoffDate.setUTCHours(0, 0, 0, 0)
  const cutoff = cutoffDate.getTime()
  const inWindow = items.filter(i => {
    const t = new Date(i.publishedAt).getTime()
    return Number.isFinite(t) && t >= cutoff
  })

  inWindow.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())

  // Scale total cap with window: 60 for 1d, 120 for 7d, up to 400 for a year.
  const cap = Math.min(400, Math.max(60, Math.round(60 + days * 8)))

  return {
    fetchedAt: Date.now(),
    days,
    items:     inWindow.slice(0, cap),
    errors,
  }
}

export async function GET(req: Request) {
  const url   = new URL(req.url)
  const days  = clampDays(url.searchParams.get('days'))
  const force = url.searchParams.get('force') === '1'

  const cached = cache.get(days)
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      items:    cached.items,
      errors:   cached.errors,
      cachedAt: new Date(cached.fetchedAt).toISOString(),
      days:     cached.days,
      stale:    false,
    })
  }

  let pending = inflight.get(days)
  if (!pending) {
    pending = buildFeed(days).finally(() => { inflight.delete(days) })
    inflight.set(days, pending)
  }

  try {
    const fresh = await pending
    cache.set(days, fresh)
    return NextResponse.json({
      items:    fresh.items,
      errors:   fresh.errors,
      cachedAt: new Date(fresh.fetchedAt).toISOString(),
      days:     fresh.days,
      stale:    false,
    })
  } catch (err) {
    if (cached) {
      return NextResponse.json({
        items:    cached.items,
        errors:   { ...cached.errors, _fetch: String(err) },
        cachedAt: new Date(cached.fetchedAt).toISOString(),
        days:     cached.days,
        stale:    true,
      })
    }
    return NextResponse.json(
      { items: [], errors: { _fetch: String(err) }, days, stale: false },
      { status: 500 }
    )
  }
}
