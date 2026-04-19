'use client'

import { useState } from 'react'
import { RawItem, ThreadMessage, EnrichedItem } from '@/types'

const SOURCE_DOT: Record<string, string> = {
  hackers:    'bg-pg-purple',
  committers: 'bg-pg-teal',
  git:        'bg-pg-teal',
  github:     'bg-pg-blue',
  commitfest: 'bg-pg-amber',
  planet:     'bg-gray-400',
}


function extractMessageId(url: string): string {
  const tail = url.split('/message-id/').pop()?.replace(/^flat\//, '') ?? ''
  // sourceUrl may already be URL-encoded (e.g. "%40" for "@"); decode so the
  // outer encodeURIComponent() in the fetch call produces a single encoding.
  try {
    return decodeURIComponent(tail)
  } catch {
    return tail
  }
}

type Enrichment = Pick<EnrichedItem, 'summary' | 'internalsTag' | 'pgVersion' | 'relevance' | 'relevanceReason'>

export function FeedCard({ item }: { item: RawItem }) {
  const [expanded, setExpanded]           = useState(false)
  const [thread, setThread]               = useState<ThreadMessage[] | null>(null)
  const [loadingThread, setLoadingThread] = useState(false)
  const [ai, setAi]                       = useState<Enrichment | null>(null)
  const [aiLoading, setAiLoading]         = useState(false)
  const [aiError, setAiError]             = useState<string | null>(null)

  const isMailingList = ['hackers', 'committers'].includes(item.source)

  async function handleExpand() {
    setExpanded(e => !e)
    if (thread || !isMailingList) return

    setLoadingThread(true)
    try {
      const messageId = extractMessageId(item.sourceUrl)
      const res = await fetch(`/api/thread?messageId=${encodeURIComponent(messageId)}`)
      const data = await res.json()
      setThread(data.messages)
    } catch {
      setThread([])
    } finally {
      setLoadingThread(false)
    }
  }

  async function handleEnrich(e: React.MouseEvent) {
    e.stopPropagation()
    if (ai || aiLoading) return
    setAiLoading(true)
    setAiError(null)
    try {
      const context = thread?.map(m => `${m.author}: ${m.body}`).join('\n\n')
      const res = await fetch('/api/enrich', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ item, context }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || 'enrichment failed')
      }
      const data = await res.json()
      setAi({
        summary:         data.summary,
        internalsTag:    data.internalsTag,
        pgVersion:       data.pgVersion,
        relevance:       data.relevance,
        relevanceReason: data.relevanceReason,
      })
    } catch (err) {
      setAiError((err as Error).message)
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <article
      className="bg-white dark:bg-white/5 border border-pg-blue/10 dark:border-white/10 rounded-xl p-3 mb-2 cursor-pointer hover:border-pg-blue/30 dark:hover:border-pg-sky/30 hover:shadow-sm transition-all"
      onClick={handleExpand}
    >
      <div className="flex items-start gap-2 mb-2">
        <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${SOURCE_DOT[item.source] ?? 'bg-gray-400'}`} />
        <h3 className="text-sm font-medium leading-snug flex-1">{item.title}</h3>
        {ai && (
          <span
            title={ai.relevanceReason}
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-pg-blue/15 text-pg-sky font-mono"
          >
            {ai.relevance}
          </span>
        )}
      </div>

      {ai ? (
        <p className="text-xs text-gray-300 leading-relaxed mb-2">{ai.summary}</p>
      ) : item.snippet ? (
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-2 line-clamp-2">
          {item.snippet}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400">
          {item.author}
        </span>
        <div className="flex items-center gap-1.5">
          {ai && (
            <>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-pg-purple/20 text-pg-purple">
                {ai.internalsTag}
              </span>
              {ai.pgVersion && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-pg-teal/20 text-pg-teal">
                  {ai.pgVersion}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-pg-blue/10 dark:border-white/10" onClick={e => e.stopPropagation()}>
          <div className="mb-3 flex items-center gap-2">
            <button
              onClick={handleEnrich}
              disabled={aiLoading || !!ai}
              className="text-[11px] border border-pg-sky/30 text-pg-sky rounded px-2 py-0.5 hover:bg-pg-sky/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {aiLoading ? 'thinking…' : ai ? '✓ enriched' : '✦ enrich with AI'}
            </button>
            {aiError && <span className="text-[11px] text-red-400">{aiError}</span>}
          </div>

          {loadingThread && (
            <p className="text-xs text-gray-400 animate-pulse">loading thread…</p>
          )}
          {!isMailingList && item.snippet && (
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed whitespace-pre-wrap mb-2">
              {item.snippet}
            </p>
          )}
          {thread && thread.length === 0 && (
            <p className="text-xs text-gray-400">No thread messages found.</p>
          )}
          {thread && thread.map((msg, i) => (
            <div key={i} className="mb-3 text-xs">
              <div className="font-medium text-gray-700 dark:text-gray-300 mb-1">
                {msg.author} · {msg.date}
              </div>
              <p className="text-gray-500 dark:text-gray-400 leading-relaxed whitespace-pre-wrap">
                {msg.body.slice(0, 600)}{msg.body.length > 600 ? '…' : ''}
              </p>
            </div>
          ))}
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-pg-blue dark:text-pg-sky hover:underline"
          >
            open on postgresql.org →
          </a>
          <a
            href={buildSearchUrl(item, ai?.internalsTag)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="ml-3 text-xs text-pg-sky/80 hover:text-pg-sky hover:underline"
            title="Search the web for context on this topic"
          >
            🔍 learn more on web →
          </a>
        </div>
      )}
    </article>
  )
}

function buildSearchUrl(item: RawItem, tag?: string): string {
  const cleanTitle = item.title
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^Re:\s*/i, '')
    .replace(/\s+v\d+(\s|$)/i, ' ')
    .trim()
  const parts = ['PostgreSQL', cleanTitle]
  if (tag && tag !== 'other') parts.push(tag)
  const q = parts.join(' ')
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}
