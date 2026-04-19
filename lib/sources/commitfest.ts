import { RawItem } from '@/types'
import { fetchRSS, makeItemId } from './rss'

export async function fetchCommitFest(): Promise<RawItem[]> {
  const entries = await fetchRSS('https://commitfest.postgresql.org/activity.rss/')

  // RSS emits one item per activity event — dedupe by patch URL, keep newest
  const seen = new Set<string>()
  const unique: typeof entries = []
  for (const e of entries) {
    if (seen.has(e.link)) continue
    seen.add(e.link)
    unique.push(e)
  }

  return unique.slice(0, 10).map(e => ({
    id:          makeItemId('commitfest', e.guid || e.link),
    source:      'commitfest' as const,
    title:       `[CommitFest] ${stripPatchPrefix(e.title)}`,
    author:      extractUser(e.description) || 'unknown',
    publishedAt: safeIsoDate(e.pubDate),
    sourceUrl:   e.link,
    snippet:     e.description.slice(0, 800),
  }))
}

function stripPatchPrefix(title: string): string {
  return title.replace(/^Patch:\s*/i, '').trim()
}

function extractUser(desc: string): string {
  const m = desc.match(/User:\s*([^\s<]+)/i)
  return m ? m[1].trim() : ''
}

function safeIsoDate(raw: string): string {
  const d = new Date(raw)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}
