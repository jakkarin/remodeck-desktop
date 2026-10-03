import { describe, it, expect } from 'vitest'
import { getGitHubCredential, parseCredentialOutput } from '../../src/main/github/credentials'
import { GitHubClient, compareUrl, parseRepoInput } from '../../src/main/github/githubClient'

describe('parseCredentialOutput', () => {
  it('parses username and password', () => {
    expect(parseCredentialOutput('protocol=https\nhost=github.com\nusername=u\npassword=p\n')).toEqual({
      username: 'u',
      password: 'p'
    })
  })
  it('handles CRLF and passwords containing =', () => {
    expect(parseCredentialOutput('username=u\r\npassword=a=b\r\n')).toEqual({ username: 'u', password: 'a=b' })
  })
  it('returns null without password', () => {
    expect(parseCredentialOutput('username=u\n')).toBeNull()
  })
})

describe('getGitHubCredential', () => {
  it('sends fill input and parses output', async () => {
    let seen: { args: string[]; opts: unknown } | null = null
    const git = {
      run: async (_cwd: string | null, args: string[], opts: unknown) => {
        seen = { args, opts }
        return { code: 0, stdout: 'username=u\npassword=p\n', stderr: '' }
      }
    }
    expect(await getGitHubCredential(git as never)).toEqual({ username: 'u', password: 'p' })
    expect(seen!.args).toEqual(['credential', 'fill'])
    expect(seen!.opts).toEqual({ input: 'protocol=https\nhost=github.com\n\n', allowFail: true })
  })
  it('returns null on non-zero exit', async () => {
    const git = { run: async () => ({ code: 128, stdout: 'password=p\n', stderr: 'x' }) }
    expect(await getGitHubCredential(git as never)).toBeNull()
  })
  it('returns null when run throws', async () => {
    const git = {
      run: async () => {
        throw new Error('boom')
      }
    }
    expect(await getGitHubCredential(git as never)).toBeNull()
  })
})

describe('parseRepoInput', () => {
  it('accepts supported forms', () => {
    expect(parseRepoInput('https://github.com/acme/api')).toEqual({ owner: 'acme', name: 'api' })
    expect(parseRepoInput('https://github.com/acme/api.git')).toEqual({ owner: 'acme', name: 'api' })
    expect(parseRepoInput('https://github.com/acme/api/')).toEqual({ owner: 'acme', name: 'api' })
    expect(parseRepoInput('git@github.com:acme/api.git')).toEqual({ owner: 'acme', name: 'api' })
    expect(parseRepoInput('acme/api')).toEqual({ owner: 'acme', name: 'api' })
  })
  it('rejects invalid input', () => {
    expect(parseRepoInput('nope')).toBeNull()
    expect(parseRepoInput('https://github.com/a/b/tree/x')).toBeNull()
    expect(parseRepoInput('')).toBeNull()
  })
})

describe('compareUrl', () => {
  it('builds url keeping slashes', () => {
    expect(compareUrl('acme', 'api', 'main', 'feat/a')).toBe(
      'https://github.com/acme/api/compare/main...feat/a?expand=1'
    )
  })
  it('encodes special characters per segment', () => {
    expect(compareUrl('acme', 'api', 'main', 'feat/a b#1')).toBe(
      'https://github.com/acme/api/compare/main...feat/a%20b%231?expand=1'
    )
  })
})

describe('GitHubClient', () => {
  it('lists repos with bearer auth', async () => {
    let url = ''
    let headers: Record<string, string> = {}
    const fake = (async (u: string, init: { headers: Record<string, string> }) => {
      url = u
      headers = init.headers
      return new Response(
        JSON.stringify([{ owner: { login: 'acme' }, name: 'api', default_branch: 'main' }]),
        { status: 200 }
      )
    }) as unknown as typeof fetch
    const c = new GitHubClient(async () => ({ username: 'u', password: 'tok' }), fake)
    expect(await c.listRepos()).toEqual([{ owner: 'acme', name: 'api', defaultBranch: 'main' }])
    expect(url).toBe('https://api.github.com/user/repos?per_page=100&sort=pushed')
    expect(headers.Authorization).toBe('Bearer tok')
  })
  it('throws Thai error without credential', async () => {
    const c = new GitHubClient(async () => null, (async () => new Response('[]')) as unknown as typeof fetch)
    await expect(c.listRepos()).rejects.toThrow('ยังไม่ได้ login GitHub — รัน git credential-manager github login ก่อน')
  })
  it('throws on non-OK status', async () => {
    const c = new GitHubClient(
      async () => ({ username: 'u', password: 't' }),
      (async () => new Response('no', { status: 401 })) as unknown as typeof fetch
    )
    await expect(c.listRepos()).rejects.toThrow('GitHub API 401')
  })
})
