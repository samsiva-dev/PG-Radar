import { RawItem } from '@/types'
import { parse } from 'node-html-parser'
import { makeItemId } from './rss'

function getSinceDateCompact(daysBack: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}0000`
}

export async function fetchHackers(): Promise<RawItem[]> {
  return scrapeMailingList('hackers', 'pgsql-hackers', 7)
}

export async function scrapeMailingList(
  source: 'hackers' | 'committers',
  list: string,
  daysBack: number
): Promise<RawItem[]> {
  const since = getSinceDateCompact(daysBack)
  const url = `https://www.postgresql.org/list/${list}/since/${since}/`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'pg-radar/1.0 (personal RSS reader)' },
    next: { revalidate: 0 },
  })
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)

  const html = await res.text()
  const root = parse(html)

  const rows = root.querySelectorAll('tr')
  const items: RawItem[] = []

  for (const row of rows) {
    const link = row.querySelector('a[href*="/message-id/"]')
    if (!link) continue

    const tds = row.querySelectorAll('td')
    const author = tds[0]?.text?.trim() ?? 'unknown'
    const timeStr = tds[1]?.text?.trim() ?? ''

    const href = link.getAttribute('href') ?? ''
    const messageUrl = href.startsWith('http')
      ? href
      : `https://www.postgresql.org${href}`
    const title = link.text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim()

    // Build an approximate ISO date from the time-of-day shown on the page
    const publishedAt = parsePageDate(since, timeStr)

    items.push({
      id:          makeItemId(source, href),
      source,
      title,
      author,
      publishedAt,
      sourceUrl:   messageUrl,
      snippet:     '',
    })
  }

  return items.slice(0, 15)
}

function parsePageDate(sinceCompact: string, timeStr: string): string {
  // sinceCompact = "202604160000", timeStr = "08:42"
  try {
    const year  = sinceCompact.slice(0, 4)
    const month = sinceCompact.slice(4, 6)
    const day   = sinceCompact.slice(6, 8)
    const [h, mi] = timeStr.split(':')
    const d = new Date(`${year}-${month}-${day}T${h.padStart(2,'0')}:${(mi ?? '00').padStart(2,'0')}:00Z`)
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  } catch {
    return new Date().toISOString()
  }
}
