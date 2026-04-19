import { RawItem } from '@/types'
import { scrapeMailingList } from './hackers'

export async function fetchCommitters(daysBack = 7): Promise<RawItem[]> {
  return scrapeMailingList('committers', 'pgsql-committers', daysBack)
}
