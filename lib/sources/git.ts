import { RawItem } from '@/types'
import { fetchRSS, makeItemId } from './rss'

export async function fetchGit(): Promise<RawItem[]> {
  const entries = await fetchRSS(
    'https://git.postgresql.org/gitweb/?p=postgresql.git;a=rss'
  )

  return entries.slice(0, 30).map(e => ({
    id:          makeItemId('git', e.guid),
    source:      'git' as const,
    title:       e.title.replace(/^[a-f0-9]+ /, ''), // strip hash prefix
    author:      e.author,
    publishedAt: new Date(e.pubDate).toISOString(),
    sourceUrl:   e.link,
    snippet:     e.description.slice(0, 800),
  }))
}
