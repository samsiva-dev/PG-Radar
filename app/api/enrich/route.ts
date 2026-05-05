import Groq from 'groq-sdk'
import { parse } from 'node-html-parser'
import { EnrichedItem, RawItem, InternalsTag } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL = 'llama-3.3-70b-versatile'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

interface CachedEnrichment {
  enrichedAt: number
  data: Omit<EnrichedItem, keyof RawItem>
}

const cache = new Map<string, CachedEnrichment>()

const INTERNALS_TAGS: InternalsTag[] = [
  'WAL', 'MVCC', 'planner', 'executor', 'buffer manager',
  'replication', 'VACUUM', 'lock manager', 'memory', 'storage',
  'parallel query', 'partitioning', 'AIO', 'other',
]

interface ModelOutput {
  summary: string
  internalsTag: InternalsTag
  pgVersion: 'PG18' | 'PG17' | 'none'
  relevance: number
  relevanceReason: string
}

export async function POST(req: Request) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'GROQ_API_KEY not configured' }, { status: 503 })
  }

  let item: RawItem
  let context: string | undefined
  try {
    const body = await req.json()
    item = body.item
    context = body.context
  } catch {
    return Response.json({ error: 'invalid body' }, { status: 400 })
  }

  if (!item?.id || !item.title) {
    return Response.json({ error: 'missing item' }, { status: 400 })
  }

  const cached = cache.get(item.id)
  if (cached && Date.now() - cached.enrichedAt < CACHE_TTL_MS) {
    return Response.json({ ...item, ...cached.data, enrichedAt: new Date(cached.enrichedAt).toISOString() })
  }

  // For mailing list items, fetch thread body server-side so the LLM always
  // has the actual message content, not just the title.
  const isMailingList = item.source === 'hackers' || item.source === 'committers'
  if (isMailingList && !context && item.sourceUrl) {
    context = await fetchMailingListBody(item.sourceUrl)
  }

  const groq = new Groq({ apiKey })

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user',   content: userPrompt(item, context) },
      ],
    })

    const text = completion.choices[0]?.message?.content
    if (!text) throw new Error('empty model response')

    const parsed = JSON.parse(text) as Partial<ModelOutput>

    const tag: InternalsTag = INTERNALS_TAGS.includes(parsed.internalsTag as InternalsTag)
      ? (parsed.internalsTag as InternalsTag)
      : 'other'

    const enrichment = {
      summary:         String(parsed.summary ?? '').slice(0, 1200),
      internalsTag:    tag,
      pgVersion:       parsed.pgVersion === 'PG18' || parsed.pgVersion === 'PG17' ? parsed.pgVersion : null,
      relevance:       Math.max(0, Math.min(100, Number(parsed.relevance ?? 0))),
      relevanceReason: String(parsed.relevanceReason ?? '').slice(0, 400),
    }

    cache.set(item.id, {
      enrichedAt: Date.now(),
      data: { ...enrichment, enrichedAt: new Date().toISOString() },
    })

    const enriched: EnrichedItem = { ...item, ...enrichment, enrichedAt: new Date().toISOString() }
    return Response.json(enriched)
  } catch (err) {
    console.error('[enrich] groq failed:', err)
    return Response.json({ error: (err as Error).message }, { status: 502 })
  }
}

async function fetchMailingListBody(sourceUrl: string): Promise<string> {
  try {
    const tail = sourceUrl.split('/message-id/').pop()?.replace(/^flat\//, '') ?? ''
    if (!tail) return ''

    let messageId = tail
    if (/%[0-9A-Fa-f]{2}/.test(messageId)) {
      try { messageId = decodeURIComponent(messageId) } catch { /* keep as-is */ }
    }

    const url = `https://www.postgresql.org/message-id/flat/${encodeURIComponent(messageId)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'pg-radar/1.0' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return ''

    const html = await res.text()
    return extractThreadContext(html)
  } catch {
    return ''
  }
}

function extractThreadContext(html: string): string {
  const root = parse(html)
  const msgDivs = root.querySelectorAll('.message, [id^="msg"]')

  const messages: string[] = []

  type HtmlNode = ReturnType<typeof root.querySelector>
  const rawDivs: HtmlNode[] = msgDivs.length > 0
    ? Array.from(msgDivs)
    : Array.from(root.querySelectorAll('pre'))
  for (const div of rawDivs.slice(0, 6)) {
    if (!div) continue
    const fromEl = div.querySelector('.from, .msgfrom')
    const bodyEl = div.querySelector('.body, .msgbody, pre') ?? div
    const author = fromEl?.text?.trim() ?? ''
    let body = bodyEl.text?.trim() ?? ''

    body = stripFooter(body)
    // Keep the first quoted block (gives "what they're replying to" context)
    // but strip deeply nested quotes (lines starting with >>)
    body = body
      .split('\n')
      .filter((l: string) => !l.trim().startsWith('>>'))
      .join('\n')
      .trim()

    if (body.length < 40) continue
    messages.push(author ? `[${author}]\n${body}` : body)
  }

  return messages.join('\n\n---\n\n').slice(0, 6000)
}

function stripFooter(text: string): string {
  const lines = text.split('\n')
  const footerIdx = lines.findIndex(
    (l, i) => l.trim() === '--' && i > lines.length - 12
  )
  const trimmed = footerIdx >= 0 ? lines.slice(0, footerIdx) : lines
  return trimmed
    .filter(l => !/^PostgreSQL.*https?:\/\//.test(l))
    .join('\n')
    .trim()
}

function systemPrompt(): string {
  return `You are a PostgreSQL internals expert summarizing community activity for a senior database engineer.

PostgreSQL subsystem reference:
- WAL: write-ahead logging, recovery, checkpoints, pg_wal
- MVCC: visibility, snapshots, transaction IDs, clog/pg_xact
- planner: query planning, cost estimation, statistics, indexes
- executor: query execution nodes, sort, hash, aggregate
- buffer manager: shared_buffers, buffer cache, page eviction
- replication: streaming replication, logical replication, slots
- VACUUM: dead tuple cleanup, autovacuum, freezing, bloat
- lock manager: heavyweight locks, LWLocks, deadlock detection
- memory: palloc, memory contexts, work_mem, huge pages
- storage: heap, page layout, toast, fsync, tablespaces
- parallel query: parallel workers, gather, DSM
- partitioning: partition pruning, routing, declarative partitioning
- AIO: asynchronous I/O, io_uring, readahead

Respond with ONLY a JSON object matching this exact schema (no markdown, no prose):
{
  "summary": string,            // 3–4 sentences: (1) what changed/proposed, (2) the technical approach or mechanism, (3) subsystem impact or performance implication, (4) why it matters — be specific, name functions/structs/GUCs when visible in context
  "internalsTag": one of [${INTERNALS_TAGS.map(t => `"${t}"`).join(', ')}],
  "pgVersion": "PG18" | "PG17" | "none",
  "relevance": integer 0–100,   // 0=doc/typo fix, 50=useful improvement, 80=significant subsystem change, 100=architectural shift
  "relevanceReason": string     // one sentence: what makes this notable or not, mention the specific impact
}`
}

function userPrompt(item: RawItem, context?: string): string {
  const sourceLabel: Record<string, string> = {
    hackers:    'pgsql-hackers mailing list',
    committers: 'pgsql-committers mailing list',
    git:        'PostgreSQL git commit',
    github:     'GitHub commit (postgres/postgres)',
    commitfest: 'CommitFest activity',
    planet:     'Planet PostgreSQL blog',
  }

  const parts: string[] = [
    `Source: ${sourceLabel[item.source] ?? item.source}`,
    `Title: ${item.title}`,
    `Author: ${item.author}`,
    `Date: ${item.publishedAt}`,
  ]

  if (item.snippet) {
    parts.push(`\nRSS description:\n${item.snippet}`)
  }

  if (context) {
    parts.push(`\nMessage body / thread (first ${Math.ceil(context.length / 1000)}k chars):\n${context}`)
  } else {
    parts.push('\n(No message body available — infer from title and source only.)')
  }

  return parts.join('\n')
}
