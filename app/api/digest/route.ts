import Groq from 'groq-sdk'
import { RawItem } from '@/types'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL = 'llama-3.3-70b-versatile'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 h

interface CachedDigest {
  generatedAt: number
  itemHash:    string
  digest:      string
  highlights:  string[]
}

let cache: CachedDigest | null = null

function hashItems(items: RawItem[]): string {
  return items.slice(0, 30).map(i => i.id).join(',')
}

export async function POST(req: Request) {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 503 })
  }

  let items: RawItem[]
  try {
    const body = await req.json()
    items = body.items
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'no items' }, { status: 400 })
  }

  const force    = new URL(req.url).searchParams.get('force') === '1'
  const itemHash = hashItems(items)

  if (!force && cache && Date.now() - cache.generatedAt < CACHE_TTL_MS && cache.itemHash === itemHash) {
    return NextResponse.json({
      digest:      cache.digest,
      highlights:  cache.highlights,
      generatedAt: new Date(cache.generatedAt).toISOString(),
      cached:      true,
    })
  }

  const groq = new Groq({ apiKey })

  const top = items.slice(0, 30)
  const lines = top
    .map((i, idx) => {
      const sourceLabel: Record<string, string> = {
        hackers: 'hackers', committers: 'committers',
        git: 'git commit', github: 'github', commitfest: 'commitfest', planet: 'blog',
      }
      const body = i.snippet ? ` — ${i.snippet.slice(0, 300)}` : ''
      return `${idx + 1}. [${sourceLabel[i.source] ?? i.source}] ${i.title} (${i.author})${body}`
    })
    .join('\n')

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a PostgreSQL internals expert writing a daily digest for senior database engineers.

Note: mailing list items may only have a title and author — infer technical context from the subject line.

Respond with ONLY a JSON object:
{
  "digest": string,        // 3–5 sentences synthesizing today's themes — identify the 2-3 dominant areas of activity (e.g. planner work, WAL changes, VACUUM improvements), name specific authors and patches, and call out the single most technically significant change and why it matters for PostgreSQL internals
  "highlights": string[]   // exactly 4–5 bullet points, each one sentence; lead with the subsystem name in brackets, e.g. "[planner] Tom Lane's patch reduces..."; pick the items with highest technical impact
}`,
        },
        {
          role: 'user',
          content: `PostgreSQL community activity (most recent first):\n\n${lines}\n\nProduce the JSON digest.`,
        },
      ],
    })

    const text = completion.choices[0]?.message?.content
    if (!text) throw new Error('empty model response')

    const parsed = JSON.parse(text) as { digest?: string; highlights?: string[] }
    const digest     = String(parsed.digest ?? '').slice(0, 1500)
    const highlights = Array.isArray(parsed.highlights)
      ? parsed.highlights.map(String).slice(0, 5)
      : []

    cache = {
      generatedAt: Date.now(),
      itemHash,
      digest,
      highlights,
    }

    return NextResponse.json({
      digest,
      highlights,
      generatedAt: new Date(cache.generatedAt).toISOString(),
      cached:      false,
    })
  } catch (err) {
    console.error('[digest] groq failed:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
