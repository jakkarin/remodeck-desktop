import { describe, it, expect } from 'vitest'
import { createGithubAdapter, adapterForHost } from '../../../src/main/gitAccess/providers'

type Reply = { status: number; body?: unknown; headers?: Record<string, string> }

// Fake fetch keyed by URL path. Unknown URLs answer 404.
function fakeFetch(routes: Record<string, Reply>) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ url, headers })
    const route = routes[url.replace('https://api.github.com', '')] ?? { status: 404 }
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status,
      headers: route.headers
    })
  }) as typeof fetch
  return { fetchImpl, calls }
}

const userOk: Reply = {
  status: 200,
  body: { login: 'jak' },
  headers: { 'github-authentication-token-expiration': '2026-12-01 00:00:00 UTC' }
}

describe('createGithubAdapter', () => {
  it('exposes the GitHub provider metadata', () => {
    const a = createGithubAdapter(fakeFetch({}).fetchImpl)
    expect(a.id).toBe('github')
    expect(a.defaultHosts).toEqual(['github.com'])
    expect(a.gitUsername).toBe('x-access-token')
    expect(a.cli).toEqual({
      command: 'gh',
      tokenEnv: 'GH_TOKEN',
      repoFlags: ['-R', '--repo'],
      repoEnv: 'GH_REPO'
    })
  })

  it('validates an owner and returns login and parsed expiry', async () => {
    const { fetchImpl } = fakeFetch({ '/user': userOk, '/orgs/org-a': { status: 200 } })
    const a = createGithubAdapter(fetchImpl)
    await expect(a.validateToken('github.com', 'org-a', 'tok')).resolves.toEqual({
      login: 'jak',
      expiresAt: '2026-12-01T00:00:00.000Z'
    })
  })

  it('falls back to a user owner when no org matches', async () => {
    const { fetchImpl } = fakeFetch({ '/user': userOk, '/users/org-a': { status: 200 } })
    const a = createGithubAdapter(fetchImpl)
    await expect(a.validateToken('github.com', 'org-a', 'tok')).resolves.toEqual({
      login: 'jak',
      expiresAt: '2026-12-01T00:00:00.000Z'
    })
  })

  it('rejects an owner that is neither an org nor a user', async () => {
    const { fetchImpl } = fakeFetch({ '/user': userOk })
    const a = createGithubAdapter(fetchImpl)
    await expect(a.validateToken('github.com', 'x', 'tok')).rejects.toThrow(/Owner x not found/)
  })

  it('rejects a token that GitHub reports as unauthorized', async () => {
    const { fetchImpl } = fakeFetch({ '/user': { status: 401 } })
    const a = createGithubAdapter(fetchImpl)
    await expect(a.validateToken('github.com', 'org-a', 'tok')).rejects.toThrow(
      'Token is invalid or expired'
    )
  })

  it('checks repo access for an owner/repo path', async () => {
    const { fetchImpl } = fakeFetch({
      '/user': userOk,
      '/repos/org-a/payments': { status: 200 }
    })
    const a = createGithubAdapter(fetchImpl)
    await expect(a.validateToken('github.com', 'org-a/payments', 'tok')).resolves.toEqual({
      login: 'jak',
      expiresAt: '2026-12-01T00:00:00.000Z'
    })
  })

  it('rejects an owner/repo path the token cannot access', async () => {
    const { fetchImpl } = fakeFetch({ '/user': userOk })
    const a = createGithubAdapter(fetchImpl)
    await expect(a.validateToken('github.com', 'org-a/payments', 'tok')).rejects.toThrow(
      /can't access org-a\/payments/
    )
  })

  it('returns a null expiry when GitHub sends no expiration header', async () => {
    const { fetchImpl } = fakeFetch({
      '/user': { status: 200, body: { login: 'jak' } },
      '/orgs/org-a': { status: 200 }
    })
    const a = createGithubAdapter(fetchImpl)
    await expect(a.validateToken('github.com', 'org-a', 'tok')).resolves.toEqual({
      login: 'jak',
      expiresAt: null
    })
  })

  it('sends the bearer token and JSON accept header on every request', async () => {
    const { fetchImpl, calls } = fakeFetch({
      '/user': userOk,
      '/repos/org-a/payments': { status: 200 }
    })
    const a = createGithubAdapter(fetchImpl)
    await a.validateToken('github.com', 'org-a/payments', 'tok')
    expect(calls.length).toBe(2)
    for (const call of calls) {
      expect(call.headers.Authorization).toBe('Bearer tok')
      expect(call.headers.Accept).toBe('application/vnd.github+json')
    }
  })

  it('uses the configured api base', async () => {
    const { fetchImpl, calls } = fakeFetch({ 'https://ghe.local/api/v3/user': userOk })
    const a = createGithubAdapter(fetchImpl, 'https://ghe.local/api/v3')
    await a.validateToken('github.com', 'org-a', 'tok').catch(() => undefined)
    expect(calls[0].url).toBe('https://ghe.local/api/v3/user')
    expect(calls.every((c) => c.url.startsWith('https://ghe.local/api/v3/'))).toBe(true)
  })

  it('never includes the token value in a rejection message', async () => {
    const { fetchImpl } = fakeFetch({ '/user': { status: 401 } })
    const a = createGithubAdapter(fetchImpl)
    const error = await a.validateToken('github.com', 'org-a', 'tok').catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain('tok')
  })

  it('validatePath accepts one or two segments and rejects three', () => {
    const a = createGithubAdapter(fakeFetch({}).fetchImpl)
    expect(a.validatePath('a/b/c')).not.toBeNull()
    expect(a.validatePath('a/b')).toBeNull()
    expect(a.validatePath('a')).toBeNull()
  })
})

describe('adapterForHost', () => {
  it('returns the adapter whose default hosts include the host', () => {
    const a = createGithubAdapter(fakeFetch({}).fetchImpl)
    expect(adapterForHost([a], 'github.com')).toBe(a)
    expect(adapterForHost([a], 'gitlab.com')).toBeNull()
  })
})
