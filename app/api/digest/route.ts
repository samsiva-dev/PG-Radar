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
    .map((i, idx) => `${idx + 1}. [${i.source}] ${i.title}${i.snippet ? ` — ${i.snippet.slice(0, 200)}` : ''}`)
    .join('\n')

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are an editor producing a short daily digest of PostgreSQL community activity for an internals-focused engineer.

Respond with ONLY a JSON object:
{
  "digest": string,        // 3–5 sentence overview paragraph; mention concrete subsystems & names
  "highlights": string[]   // 3–5 most important items, each as a single short sentence
}`,
        },
        {
          role: 'user',
          content: `Items from the last 24h:\n\n${lines}\n\nProduce the JSON.`,
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
