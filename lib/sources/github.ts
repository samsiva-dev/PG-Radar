import { RawItem } from '@/types'
import { makeItemId } from './rss'

interface GitHubCommit {
  sha: string
  html_url: string
  commit: {
    author: { name: string; date: string }
    message: string
  }
}

export async function fetchGitHub(): Promise<RawItem[]> {
  const headers: Record<string, string> = {
    'User-Agent': 'pg-radar/1.0',
    'Accept':     'application/vnd.github+json',
  }
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  const res = await fetch(
    'https://api.github.com/repos/postgres/postgres/commits?per_page=30',
    { headers, next: { revalidate: 300 } }
  )

  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text().catch(() => '')}`)
  }

  const commits = (await res.json()) as GitHubCommit[]

  return commits.map(c => {
    const message    = c.commit.message
    const firstLine  = message.split('\n')[0]
    const restOfBody = message.slice(firstLine.length).trim()
    return {
      id:          makeItemId('github', c.sha),
      source:      'github' as const,
      title:       firstLine,
      author:      c.commit.author.name,
      publishedAt: new Date(c.commit.author.date).toISOString(),
      sourceUrl:   c.html_url,
      snippet:     restOfBody.slice(0, 800),
    }
  })
}
