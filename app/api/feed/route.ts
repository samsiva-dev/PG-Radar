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

const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes

interface CachedFeed {
  fetchedAt: number
  items:     RawItem[]
  errors:    Record<string, string>
}

let cache: CachedFeed | null = null
let inflight: Promise<CachedFeed> | null = null

const SOURCES = [
  { name: 'hackers',    fn: fetchHackers },
  { name: 'committers', fn: fetchCommitters },
  { name: 'git',        fn: fetchGit },
  { name: 'github',     fn: fetchGitHub },
  { name: 'planet',     fn: fetchPlanet },
  { name: 'commitfest', fn: fetchCommitFest },
] as const

async function buildFeed(): Promise<CachedFeed> {
  const results = await Promise.allSettled(SOURCES.map(s => s.fn()))

  const errors: Record<string, string> = {}
  const items: RawItem[] = []

  results.forEach((r, i) => {
    const sourceName = SOURCES[i].name
    if (r.status === 'fulfilled') {
      items.push(...r.value)
    } else {
      errors[sourceName] = r.reason instanceof Error ? r.reason.message : String(r.reason)
      console.error(`[feed] source ${sourceName} failed:`, r.reason)
    }
  })

  items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())

  return {
    fetchedAt: Date.now(),
    items:     items.slice(0, 60),
    errors,
  }
}

export async function GET(req: Request) {
  const force = new URL(req.url).searchParams.get('force') === '1'

  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      items:     cache.items,
      errors:    cache.errors,
      cachedAt:  new Date(cache.fetchedAt).toISOString(),
      stale:     false,
    })
  }

  // Coalesce concurrent rebuilds
  if (!inflight) {
    inflight = buildFeed().finally(() => { inflight = null })
  }

  try {
    const fresh = await inflight
    cache = fresh
    return NextResponse.json({
      items:    fresh.items,
      errors:   fresh.errors,
      cachedAt: new Date(fresh.fetchedAt).toISOString(),
      stale:    false,
    })
  } catch (err) {
    // If rebuild fails entirely, fall back to stale cache if any
    if (cache) {
      return NextResponse.json({
        items:    cache.items,
        errors:   { ...cache.errors, _fetch: String(err) },
        cachedAt: new Date(cache.fetchedAt).toISOString(),
        stale:    true,
      })
    }
    return NextResponse.json({ items: [], errors: { _fetch: String(err) }, stale: false }, { status: 500 })
  }
}
