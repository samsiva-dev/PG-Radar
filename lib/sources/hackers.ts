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

export async function fetchHackers(daysBack = 7): Promise<RawItem[]> {
  return scrapeMailingList('hackers', 'pgsql-hackers', daysBack)
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
  if (!timeStr) return new Date().toISOString()
  try {
    // Try direct parse first — covers "19 Apr 2026 14:23:17 +0000",
    // "2026-04-19 14:23", "Apr 15, 2026", etc.
    const direct = new Date(timeStr)
    if (!isNaN(direct.getTime()) && direct.getFullYear() > 2000) {
      return direct.toISOString()
    }

    // If it's a bare HH:MM shown for today's messages, use today's date
    const timeOnly = timeStr.match(/^(\d{1,2}):(\d{2})$/)
    if (timeOnly) {
      const now = new Date()
      return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
          Number(timeOnly[1]), Number(timeOnly[2]))
      ).toISOString()
    }

    // Last resort: combine sinceCompact date with any HH:MM found in timeStr
    const year  = sinceCompact.slice(0, 4)
    const month = sinceCompact.slice(4, 6)
    const day   = sinceCompact.slice(6, 8)
    const hm    = timeStr.match(/(\d{1,2}):(\d{2})/)
    const h  = hm ? hm[1].padStart(2, '0') : '00'
    const mi = hm ? hm[2].padStart(2, '0') : '00'
    const d = new Date(`${year}-${month}-${day}T${h}:${mi}:00Z`)
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  } catch {
    return new Date().toISOString()
  }
}
