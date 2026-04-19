import { createHash } from 'crypto'
import { XMLParser } from 'fast-xml-parser'

export interface RSSEntry {
  guid:        string
  title:       string
  link:        string
  author:      string
  pubDate:     string
  description: string
}

export async function fetchRSS(url: string): Promise<RSSEntry[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'pg-radar/1.0 (personal RSS reader)' },
    next: { revalidate: 0 },   // always fresh
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch RSS from ${url}: ${res.status}`)
  }
  const xml = await res.text()
  return parseRSS(xml)
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function parseRSS(xml: string): RSSEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    cdataPropName: '__cdata',
    textNodeName: '#text',
    parseAttributeValue: false,
    parseTagValue: true,
    trimValues: true,
    isArray: (name) => name === 'item',
  })

  const result = parser.parse(xml)

  // Handle both RSS 2.0 and Atom
  const channel = result?.rss?.channel ?? result?.feed
  if (!channel) return []

  const items: unknown[] = channel.item ?? channel.entry ?? []

  return items.map((item: unknown) => {
    const i = item as Record<string, unknown>
    const guid   = extractText(i.guid)   || extractText(i.id)   || extractText(i.link)  || ''
    const link   = extractLink(i.link)   || extractText(i.guid) || ''
    const author = extractText(i.author) || extractText(i['dc:creator']) || ''
    const date   = extractText(i.pubDate)|| extractText(i.updated) || extractText(i.published) || ''
    const desc   = extractText(i.description) || extractText(i.summary) || extractText(i.content) || ''
    const title  = extractText(i.title) || '(no title)'

    return {
      guid:        guid,
      title:       stripHtml(title),
      link:        link,
      author:      stripHtml(author),
      pubDate:     date,
      description: stripHtml(desc),
    }
  })
}

function extractText(val: unknown): string {
  if (typeof val === 'string') return val
  if (typeof val === 'number') return String(val)
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>
    if (obj.__cdata) return String(obj.__cdata)
    if (obj['#text']) return String(obj['#text'])
    if (obj.name) return String(obj.name)
  }
  return ''
}

function extractLink(val: unknown): string {
  if (typeof val === 'string') return val
  if (Array.isArray(val)) {
    // Atom <link> elements — find the alternate one
    const alt = val.find((l: unknown) => {
      const obj = l as Record<string, unknown>
      return obj['@_rel'] === 'alternate' || !obj['@_rel']
    })
    if (alt) {
      const obj = alt as Record<string, unknown>
      return String(obj['@_href'] || '')
    }
  }
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>
    if (obj['@_href']) return String(obj['@_href'])
    if (obj.__cdata) return String(obj.__cdata)
    if (obj['#text']) return String(obj['#text'])
  }
  return ''
}

export function makeItemId(source: string, guid: string): string {
  return createHash('sha256')
    .update(`${source}:${guid}`)
    .digest('hex')
    .slice(0, 16)
}
