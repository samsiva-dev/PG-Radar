import Groq from 'groq-sdk'
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
      summary:         String(parsed.summary ?? '').slice(0, 800),
      internalsTag:    tag,
      pgVersion:       parsed.pgVersion === 'PG18' || parsed.pgVersion === 'PG17' ? parsed.pgVersion : null,
      relevance:       Math.max(0, Math.min(100, Number(parsed.relevance ?? 0))),
      relevanceReason: String(parsed.relevanceReason ?? '').slice(0, 300),
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

function systemPrompt(): string {
  return `You are an analyst summarizing PostgreSQL community activity for an internals-focused engineer.

Respond with ONLY a JSON object matching this exact schema (no markdown, no prose):
{
  "summary": string,            // 2–3 sentence plain-English summary
  "internalsTag": one of [${INTERNALS_TAGS.map(t => `"${t}"`).join(', ')}],
  "pgVersion": "PG18" | "PG17" | "none",
  "relevance": integer 0–100,   // 0=trivial doc fix, 100=major internals change
  "relevanceReason": string     // one sentence
}`
}

function userPrompt(item: RawItem, context?: string): string {
  return `Source: ${item.source}
Title: ${item.title}
Author: ${item.author}
Date: ${item.publishedAt}

Snippet:
${item.snippet || '(none)'}

${context ? `Additional thread context (truncated):\n${context.slice(0, 4000)}\n` : ''}`
}
