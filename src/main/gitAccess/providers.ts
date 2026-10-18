import type { GitProviderId } from '../../shared/gitAccess'

export type CliSpec = {
  command: string
  tokenEnv: string
  repoFlags: string[]
  repoEnv: string | null
}

export interface ProviderAdapter {
  readonly id: GitProviderId
  readonly defaultHosts: readonly string[]
  readonly gitUsername: string
  readonly cli: CliSpec | null
  /** Expects an already-normalized path; returns an error message or null. */
  validatePath(path: string): string | null
  validateToken(
    host: string,
    path: string,
    token: string
  ): Promise<{ login: string; expiresAt: string | null }>
}

const EXPIRY_HEADER = 'github-authentication-token-expiration'

/** Parses GitHub's `2026-12-01 00:00:00 UTC` expiry header into ISO 8601, or null when absent or unparseable. */
function parseExpiry(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value.replace(' UTC', 'Z').replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function createGithubAdapter(
  fetchImpl: typeof fetch = fetch,
  apiBase = 'https://api.github.com'
): ProviderAdapter {
  const get = (token: string, url: string): Promise<Response> =>
    fetchImpl(`${apiBase}${url}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json'
      }
    })

  return {
    id: 'github',
    defaultHosts: ['github.com'],
    gitUsername: 'x-access-token',
    cli: { command: 'gh', tokenEnv: 'GH_TOKEN', repoFlags: ['-R', '--repo'], repoEnv: 'GH_REPO' },

    validatePath(path) {
      const count = path.split('/').length
      return count === 1 || count === 2 ? null : 'GitHub scope must be an owner or an owner/repo'
    },

    async validateToken(_host, path, token) {
      const user = await get(token, '/user')
      if (user.status === 401) throw new Error('Token is invalid or expired')
      if (!user.ok) throw new Error(`GitHub API ${user.status}`)
      const { login } = (await user.json()) as { login: string }
      const expiresAt = parseExpiry(user.headers.get(EXPIRY_HEADER))

      const [owner, repo] = path.split('/')
      if (repo === undefined) {
        const org = await get(token, `/orgs/${owner}`)
        if (org.ok) return { login, expiresAt }
        const account = await get(token, `/users/${owner}`)
        if (account.ok) return { login, expiresAt }
        if (org.status !== 404 || account.status !== 404) {
          throw new Error(`GitHub API ${org.status !== 404 ? org.status : account.status}`)
        }
        throw new Error(`Owner ${owner} not found`)
      }

      const repoRes = await get(token, `/repos/${owner}/${repo}`)
      if (repoRes.ok) return { login, expiresAt }
      if (repoRes.status === 404 || repoRes.status === 403) {
        throw new Error(`Token can't access ${path}`)
      }
      throw new Error(`GitHub API ${repoRes.status}`)
    }
  }
}

export function adapterForHost(adapters: ProviderAdapter[], host: string): ProviderAdapter | null {
  return adapters.find((a) => a.defaultHosts.includes(host)) ?? null
}
