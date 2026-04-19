'use client'

import { useState } from 'react'
import { RawItem } from '@/types'

interface DigestData {
  digest:      string
  highlights:  string[]
  generatedAt: string
}

export function DigestBanner({ items }: { items: RawItem[] }) {
  const [data, setData]       = useState<DigestData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [open, setOpen]       = useState(true)

  async function generate(force = false) {
    if (loading || items.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(force ? '/api/digest?force=1' : '/api/digest', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ items }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(e.error || 'digest failed')
      }
      setData(await res.json())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="px-4 py-3 border-b border-pg-blue/10 bg-pg-blue/5 dark:bg-pg-sky/5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-pg-blue dark:text-pg-sky uppercase tracking-wide">
            ✦ daily digest
          </span>
          {data && (
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              generated {new Date(data.generatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!data && (
            <button
              onClick={() => generate()}
              disabled={loading || items.length === 0}
              className="text-xs border border-pg-sky/40 text-pg-sky rounded px-2 py-0.5 hover:bg-pg-sky/10 transition-colors disabled:opacity-50"
            >
              {loading ? 'thinking…' : 'generate'}
            </button>
          )}
          {data && (
            <>
              <button
                onClick={() => generate(true)}
                disabled={loading}
                className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-pg-sky transition-colors disabled:opacity-50"
              >
                regenerate
              </button>
              <button
                onClick={() => setOpen(o => !o)}
                className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-pg-sky transition-colors"
              >
                {open ? 'hide' : 'show'}
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

      {data && open && (
        <div className="mt-2">
          <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">{data.digest}</p>
          {data.highlights.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-300 list-disc list-inside">
              {data.highlights.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
