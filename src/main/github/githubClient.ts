import type { Credential } from './credentials'

// Lives in shared so the renderer can derive the default clone path from the same parser.
export { parseRepoInput } from '../../shared/validate'

export function compareUrl(owner: string, name: string, base: string, target: string): string {
  const enc = (b: string): string => b.split('/').map(encodeURIComponent).join('/')
  return `https://github.com/${owner}/${name}/compare/${enc(base)}...${enc(target)}?expand=1`
}

export class GitHubClient {
  constructor(
    private readonly cred: () => Promise<Credential | null>,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly apiBase = 'https://api.github.com'
  ) {}

  async listRepos(): Promise<{ owner: string; name: string; defaultBranch: string }[]> {
    const c = await this.cred()
    if (!c) throw new Error('Not logged in to GitHub — run git credential-manager github login first')
    const res = await this.fetchImpl(`${this.apiBase}/user/repos?per_page=100&sort=pushed`, {
      headers: {
        Authorization: `Bearer ${c.password}`,
        Accept: 'application/vnd.github+json'
      }
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const data = (await res.json()) as {
      owner: { login: string }
      name: string
      default_branch: string
    }[]
    return data.map((r) => ({ owner: r.owner.login, name: r.name, defaultBranch: r.default_branch }))
  }
}
