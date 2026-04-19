import { ThreadMessage } from '@/types'
import { parse } from 'node-html-parser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Matches lines starting with "--" or "PostgreSQL" near the end (footer detection)
const PG_FOOTER_LINE_RE = /^--\s*$|^PostgreSQL.*https?:\/\//

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  let messageId = searchParams.get('messageId')

  if (!messageId) return new Response('missing messageId', { status: 400 })

  // Defensively decode if the value is still percent-encoded (e.g. "%40")
  // so the encodeURIComponent() below produces exactly one encoding pass.
  if (/%[0-9A-Fa-f]{2}/.test(messageId)) {
    try { messageId = decodeURIComponent(messageId) } catch { /* keep as-is */ }
  }

  const upstreamUrl = `https://www.postgresql.org/message-id/flat/${encodeURIComponent(messageId)}`
  const res = await fetch(upstreamUrl, {
    headers: { 'User-Agent': 'pg-radar/1.0' },
  })

  if (!res.ok) {
    return new Response(`thread fetch failed: ${res.status}`, { status: 502 })
  }

  const html = await res.text()
  const messages = parseThreadHtml(html)

  return Response.json({ messages })
}

function parseThreadHtml(html: string): ThreadMessage[] {
  const root = parse(html)

  // The flat view wraps each message in a <div class="message"> or <div id="msg...">
  // Try multiple selectors used by postgresql.org archives
  const msgDivs = root.querySelectorAll('.message, [id^="msg"]')

  if (msgDivs.length === 0) {
    // Fallback: try to parse the page differently
    return parseFallback(root)
  }

  const messages: ThreadMessage[] = []

  for (const div of msgDivs.slice(0, 20)) {
    const fromEl  = div.querySelector('.from, .msgfrom')
    const dateEl  = div.querySelector('.date, .msgdate')
    const bodyEl  = div.querySelector('.body, .msgbody, pre')

    const author = fromEl?.text?.trim() ?? 'unknown'
    const date   = dateEl?.text?.trim() ?? ''
    let   body   = bodyEl?.text?.trim() ?? div.text?.trim() ?? ''

    // Strip PG mailing list footer
    body = stripMailingListFooter(body)

    if (body.length > 50) {
      messages.push({ author, date, body })
    }
  }

  return messages
}

function parseFallback(root: ReturnType<typeof parse>): ThreadMessage[] {
  // Try to find <pre> blocks which contain message bodies
  const pres = root.querySelectorAll('pre')
  const messages: ThreadMessage[] = []

  for (const pre of pres.slice(0, 20)) {
    const text = pre.text?.trim() ?? ''
    if (text.length < 50) continue

    // Try to extract From: and Date: headers from the text
    const fromMatch = text.match(/^From:\s*(.+)$/m)
    const dateMatch = text.match(/^Date:\s*(.+)$/m)

    messages.push({
      author: fromMatch?.[1]?.trim() ?? 'unknown',
      date:   dateMatch?.[1]?.trim() ?? '',
      body:   stripMailingListFooter(text),
    })
  }

  return messages
}

function stripMailingListFooter(text: string): string {
  // Remove quoted lines
  const lines = text.split('\n')
  const stripped = lines.filter(l => !l.trim().startsWith('>'))

  // Remove standard PG list footer (everything after "-- " followed by unsubscribe info)
  const footerIdx = stripped.findIndex(
    (l, i) => l.trim() === '--' && i > stripped.length - 10
  )
  const trimmed = footerIdx >= 0 ? stripped.slice(0, footerIdx) : stripped

  return trimmed.join('\n').replace(PG_FOOTER_LINE_RE, '').trim()
}
