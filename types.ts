export interface RawItem {
  id: string                   // sha256(source + guid/link)
  source: 'hackers' | 'committers' | 'git' | 'planet' | 'commitfest' | 'github'
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

export interface ThreadMessage {
  author: string
  date: string
  body: string
}
