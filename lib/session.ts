import { EnrichedItem } from '@/types'

const CACHE_VERSION = 'v1'
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
