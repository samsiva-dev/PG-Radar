import { RawItem } from '@/types'
import { scrapeMailingList } from './hackers'

export async function fetchCommitters(): Promise<RawItem[]> {
  return scrapeMailingList('committers', 'pgsql-committers', 3)
}
