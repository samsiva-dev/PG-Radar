import { RawItem } from '@/types'
import { fetchRSS, makeItemId } from './rss'

export async function fetchPlanet(): Promise<RawItem[]> {
  const entries = await fetchRSS('https://planet.postgresql.org/rss20.xml')

  return entries.slice(0, 10).map(e => ({
    id:          makeItemId('planet', e.guid),
    source:      'planet' as const,
    title:       e.title,
    author:      e.author,
    publishedAt: new Date(e.pubDate).toISOString(),
    sourceUrl:   e.link,
    snippet:     e.description.slice(0, 800),
  }))
}
