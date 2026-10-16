import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApprovalService } from '../../../src/main/approval/approvalService'
import { GitBridge } from '../../../src/main/bridge/gitBridge'
import type { Credential } from '../../../src/main/github/credentials'
import { Store } from '../../../src/main/store/store'
import type { ApprovalDecision, ApprovalRequest, Repo } from '../../../src/shared/types'
import { startHttpBackend } from '../../helpers/httpBackend'
import { git, makeTmp } from '../../helpers/repos'

const TOKEN = 'tok_1'
const EXPECTED_AUTH = 'Basic ' + Buffer.from('x-access-token:test-token').toString('base64')
const ident = ['-c', 'user.name=test', '-c', 'user.email=test@example.com']

let tmp: string
let bare: string
let work: string
let backend: Awaited<ReturnType<typeof startHttpBackend>>
let store: Store
let repo: Repo
let bridge: GitBridge
let port: number
let decision: ApprovalDecision | Promise<ApprovalDecision>
let prompts: ApprovalRequest[]
let credential: Credential | null

type Res = { code: number; stdout: string; stderr: string }

function run(cwd: string, args: string[]): Promise<Res> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
        resolve({ code, stdout, stderr })
      }
    )
  })
}

/** git in the client clone, with its GitHub traffic rewritten to go through the bridge. */
function client(...args: string[]): Promise<Res> {
  return run(work, [
    '-c',
    `url.http://127.0.0.1:${port}/s/${TOKEN}/.insteadOf=${backend.url}/`,
    '-c',
    'credential.helper=',
    ...ident,
    ...args
  ])
}

async function commit(file: string, content: string): Promise<string> {
  fs.writeFileSync(path.join(work, file), content)
  await git(work, 'add', '-A')
  await git(work, ...ident, 'commit', '-m', file)
  return (await git(work, 'rev-parse', 'HEAD')).trim()
}

const remoteRef = async (ref: string): Promise<string | null> => {
  const r = await run(bare, ['rev-parse', '--verify', '--quiet', ref])
  return r.code === 0 ? r.stdout.trim() : null
}

function get(urlPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      })
      .on('error', reject)
  })
}

function post(urlPath: string, body: Buffer): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers: { 'content-type': 'application/x-git-receive-pack-request' }
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (c: string) => (text += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }))
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

const receivePackPosts = (): { method: string; path: string; authorization?: string }[] =>
  backend.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/git-receive-pack'))

beforeEach(async () => {
  tmp = makeTmp()
  const root = path.join(tmp, 'root')
  bare = path.join(root, 'acme', 'api.git')
  fs.mkdirSync(bare, { recursive: true })
  await git(bare, 'init', '--bare', '-b', 'main')
  work = path.join(tmp, 'work')
  fs.mkdirSync(work)
  await git(work, 'init', '-b', 'main')
  await commit('a.txt', 'a')
  await git(work, 'push', bare, 'main:main')

  backend = await startHttpBackend(root)
  await git(work, 'remote', 'add', 'origin', `${backend.url}/acme/api.git`)

  store = new Store(path.join(tmp, 'data'))
  repo = store.upsertRepo('acme', 'api')
  decision = 'once'
  prompts = []
  credential = { username: 'x-access-token', password: 'test-token' }
  const approval = new ApprovalService({
    store,
    prompt: async (req) => {
      prompts.push(req)
      return decision
    },
    notify: () => {}
  })
  bridge = new GitBridge({
    upstreamBase: backend.url,
    credential: async () => credential,
    approval,
    store
  })
  port = await bridge.start()
  bridge.registerSession({
    token: TOKEN,
    sessionId: 'sess1',
    workspaceId: 'ws1',
    repo,
    tabLabel: 'Terminal 1'
  })
})

afterEach(async () => {
  await bridge.stop()
  await backend.close()
  // Windows may briefly keep handles open after git child processes exit.
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

describe('GitBridge', () => {
  it('fetch works without prompting and injects the credential', async () => {
    const r = await client('fetch', 'origin')
    expect(r.code, r.stderr).toBe(0)
    expect(await git(work, 'rev-parse', 'origin/main')).toBe(await git(work, 'rev-parse', 'main'))
    expect(prompts).toHaveLength(0)
    expect(backend.requests.length).toBeGreaterThan(0)
    for (const req of backend.requests) expect(req.authorization).toBe(EXPECTED_AUTH)
    expect(store.readPushLog(10)).toEqual([])
  })

  it('push approved once reaches the backend and is logged ok', async () => {
    await git(work, 'checkout', '-b', 'feat')
    const sha = await commit('b.txt', 'b')
    const r = await client('push', 'origin', 'feat')
    expect(r.code, r.stderr).toBe(0)
    expect(await remoteRef('refs/heads/feat')).toBe(sha)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject({
      repoId: repo.id,
      repoLabel: 'acme/api',
      sessionId: 'sess1',
      tabLabel: 'Terminal 1',
      updates: [{ newSha: sha, ref: 'refs/heads/feat' }]
    })
    const log = store.readPushLog(10)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      repo: 'acme/api',
      workspaceId: 'ws1',
      channel: 'bridge',
      result: 'ok',
      updates: [{ newSha: sha, ref: 'refs/heads/feat' }]
    })
    for (const req of receivePackPosts()) expect(req.authorization).toBe(EXPECTED_AUTH)
  })

  it('a push the backend rejects (200 + ng) is logged error with the ref and reason', async () => {
    await git(bare, 'config', 'receive.denyNonFastForwards', 'true')
    await git(work, 'checkout', '-b', 'feat')
    await commit('b.txt', 'b')
    expect((await client('push', 'origin', 'feat')).code).toBe(0)
    const pushed = await remoteRef('refs/heads/feat')
    fs.writeFileSync(path.join(work, 'b.txt'), 'rewritten')
    await git(work, 'add', '-A')
    await git(work, ...ident, 'commit', '--amend', '-m', 'rewritten')
    const r = await client('push', '--force', 'origin', 'feat')
    expect(r.code).not.toBe(0)
    // the client still sees git's own report: the response bytes were streamed unchanged
    expect(r.stderr).toMatch(/\[remote rejected\] feat -> feat/)
    expect(await remoteRef('refs/heads/feat')).toBe(pushed)
    const log = store.readPushLog(10)
    expect(log.map((e) => e.result)).toEqual(['error', 'ok'])
    expect(log[0].detail).toContain('ng refs/heads/feat')
    expect(log[0].detail).toMatch(/non-fast-forward/)
  })

  it('denied push fails, leaves the backend unchanged and is logged denied', async () => {
    decision = 'deny'
    await git(work, 'checkout', '-b', 'feat')
    await commit('b.txt', 'b')
    const r = await client('push', 'origin', 'feat')
    expect(r.code).not.toBe(0)
    expect(await remoteRef('refs/heads/feat')).toBeNull()
    expect(prompts).toHaveLength(1)
    expect(receivePackPosts()).toHaveLength(0)
    expect(store.readPushLog(10)[0]).toMatchObject({ result: 'denied', channel: 'bridge' })
  })

  it('push to a protected branch is blocked without prompting', async () => {
    const before = await remoteRef('refs/heads/main')
    await commit('b.txt', 'b')
    const r = await client('push', 'origin', 'main')
    expect(r.code).not.toBe(0)
    expect(prompts).toHaveLength(0)
    expect(await remoteRef('refs/heads/main')).toBe(before)
    const log = store.readPushLog(10)
    expect(log[0]).toMatchObject({ result: 'blocked', detail: 'branch main is protected' })
  })

  it('re-reads the repo policy at request time', async () => {
    store.updateRepo(repo.id, { protectedBranches: [] })
    const sha = await commit('b.txt', 'b')
    const r = await client('push', 'origin', 'main')
    expect(r.code, r.stderr).toBe(0)
    expect(prompts).toHaveLength(1)
    expect(await remoteRef('refs/heads/main')).toBe(sha)
  })

  it('branch deletion is blocked', async () => {
    await git(work, 'push', bare, 'main:feat')
    const before = await remoteRef('refs/heads/feat')
    const r = await client('push', 'origin', ':feat')
    expect(r.code).not.toBe(0)
    expect(prompts).toHaveLength(0)
    expect(await remoteRef('refs/heads/feat')).toBe(before)
    expect(store.readPushLog(10)[0]).toMatchObject({
      result: 'blocked',
      detail: 'Deleting is not allowed: refs/heads/feat'
    })
  })

  it('rejects unknown tokens, mismatched repos, unknown paths and revoked sessions with 403', async () => {
    const q = '?service=git-upload-pack'
    expect(await get(`/s/${TOKEN}/acme/api.git/info/refs${q}`)).toBe(200)
    expect(await get(`/s/${TOKEN}/ACME/Api/info/refs${q}`)).toBe(200)
    expect(await get(`/s/wrong/acme/api.git/info/refs${q}`)).toBe(403)
    expect(await get(`/s/${TOKEN}/acme/other.git/info/refs${q}`)).toBe(403)
    expect(await get(`/s/${TOKEN}/acme/api.git/HEAD`)).toBe(403)
    expect(await get(`/acme/api.git/info/refs${q}`)).toBe(403)
    bridge.revokeSession(TOKEN)
    expect(await get(`/s/${TOKEN}/acme/api.git/info/refs${q}`)).toBe(403)
  })

  it('large push with the 0000 probe succeeds with exactly one prompt', async () => {
    await git(work, 'checkout', '-b', 'feat')
    const sha = await commit('big.bin', crypto.randomBytes(32 * 1024).toString('base64'))
    const r = await client('-c', 'http.postBuffer=1024', 'push', 'origin', 'feat')
    expect(r.code, r.stderr).toBe(0)
    expect(await remoteRef('refs/heads/feat')).toBe(sha)
    expect(prompts).toHaveLength(1)
    expect(receivePackPosts()).toHaveLength(2)
    const log = store.readPushLog(10)
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ result: 'ok' })
  })

  it('malformed receive-pack body is refused with 400 and logged blocked', async () => {
    const res = await post(`/s/${TOKEN}/acme/api.git/git-receive-pack`, Buffer.from('zzzz'))
    expect(res.status).toBe(400)
    expect(res.body).not.toContain('test-token')
    expect(receivePackPosts()).toHaveLength(0)
    expect(store.readPushLog(10)[0]).toMatchObject({
      result: 'blocked',
      detail: 'pkt-line: invalid length prefix'
    })
  })

  it('oversized command section is refused with 413', async () => {
    const line = `${'1'.repeat(40)} ${'2'.repeat(40)} refs/heads/${'x'.repeat(900)}\n`
    const pkt = (line.length + 4).toString(16).padStart(4, '0') + line
    const res = await post(
      `/s/${TOKEN}/acme/api.git/git-receive-pack`,
      Buffer.from(pkt.repeat(1200))
    )
    expect(res.status).toBe(413)
    expect(prompts).toHaveLength(0)
    expect(receivePackPosts()).toHaveLength(0)
  })

  it('does not forward a push whose client disconnected while awaiting approval', async () => {
    let answer!: (d: ApprovalDecision) => void
    decision = new Promise<ApprovalDecision>((resolve) => (answer = resolve))
    const line = `${'0'.repeat(40)} ${'2'.repeat(40)} refs/heads/feat\n`
    const body = (line.length + 4).toString(16).padStart(4, '0') + line + '0000'
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: `/s/${TOKEN}/acme/api.git/git-receive-pack`,
      method: 'POST',
      headers: { 'content-type': 'application/x-git-receive-pack-request' }
    })
    req.on('error', () => {})
    req.end(body)
    await vi.waitFor(() => expect(prompts).toHaveLength(1))
    req.destroy()
    await new Promise((r) => setTimeout(r, 100))
    answer('once')
    await new Promise((r) => setTimeout(r, 200))
    expect(receivePackPosts()).toHaveLength(0)
    expect(store.readPushLog(10)).toEqual([])
  })

  it('missing credential answers 502', async () => {
    credential = null
    const r = await client('fetch', 'origin')
    expect(r.code).not.toBe(0)
    expect(await get(`/s/${TOKEN}/acme/api.git/info/refs?service=git-upload-pack`)).toBe(502)
    expect(backend.requests).toHaveLength(0)
  })
})

type Reply = { status: number; body: string; headers: http.IncomingHttpHeaders }

function send(opts: {
  path: string
  method?: string
  body?: Buffer | string
  headers?: Record<string, string>
  port?: number
}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: opts.port ?? port,
        path: opts.path,
        method: opts.method ?? 'GET',
        headers: opts.headers
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (c: string) => (text += c))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: text, headers: res.headers })
        )
      }
    )
    req.on('error', reject)
    req.end(opts.body)
  })
}

const RP = `/s/${TOKEN}/acme/api.git/git-receive-pack`
const RP_TYPE = { 'content-type': 'application/x-git-receive-pack-request' }

/** A receive-pack body creating refs/heads/feat (commands only, no pack). */
function createFeatBody(): string {
  const line = `${'0'.repeat(40)} ${'2'.repeat(40)} refs/heads/feat\n`
  return (line.length + 4).toString(16).padStart(4, '0') + line + '0000'
}

async function withBridge(
  deps: Partial<ConstructorParameters<typeof GitBridge>[0]>,
  fn: (bridgePort: number) => Promise<void>
): Promise<void> {
  const other = new GitBridge({
    upstreamBase: backend.url,
    credential: async () => credential,
    approval: new ApprovalService({ store, prompt: async () => decision, notify: () => {} }),
    store,
    ...deps
  })
  const otherPort = await other.start()
  other.registerSession({
    token: TOKEN,
    sessionId: 'sess1',
    workspaceId: 'ws1',
    repo,
    tabLabel: 'Terminal 1'
  })
  try {
    await fn(otherPort)
  } finally {
    await other.stop()
  }
}

describe('GitBridge hardening', () => {
  it('does not forward a push whose session was revoked while awaiting approval', async () => {
    let answer!: (d: ApprovalDecision) => void
    decision = new Promise<ApprovalDecision>((resolve) => (answer = resolve))
    const reply = send({ path: RP, method: 'POST', headers: RP_TYPE, body: createFeatBody() })
    await vi.waitFor(() => expect(prompts).toHaveLength(1))
    bridge.revokeSession(TOKEN)
    answer('session')
    const res = await reply
    expect(res.status).toBe(403)
    expect(receivePackPosts()).toHaveLength(0)
    expect(store.readPushLog(10)[0]).toMatchObject({ result: 'denied', detail: 'session closed' })
    // The late 'session' answer must not leave a grant behind for the dead session.
    decision = 'deny'
    bridge.registerSession({
      token: TOKEN,
      sessionId: 'sess1',
      workspaceId: 'ws1',
      repo,
      tabLabel: 'Terminal 1'
    })
    await send({ path: RP, method: 'POST', headers: RP_TYPE, body: createFeatBody() })
    expect(prompts).toHaveLength(2)
  })

  it('replaces a client-supplied Authorization header with the bridge credential', async () => {
    const res = await send({
      path: `/s/${TOKEN}/acme/api.git/info/refs?service=git-upload-pack`,
      headers: { authorization: 'Basic ZXZpbDpldmls' }
    })
    expect(res.status).toBe(200)
    expect(backend.requests.map((r) => r.authorization)).toEqual([EXPECTED_AUTH])
  })

  it('refuses an encoded receive-pack body with 400 and logs blocked', async () => {
    const res = await send({
      path: RP,
      method: 'POST',
      headers: { ...RP_TYPE, 'content-encoding': 'gzip' },
      body: createFeatBody()
    })
    expect(res.status).toBe(400)
    expect(prompts).toHaveLength(0)
    expect(receivePackPosts()).toHaveLength(0)
    expect(store.readPushLog(10)[0]).toMatchObject({
      result: 'blocked',
      detail: 'unsupported content-encoding'
    })
  })

  it('maps an upstream 401 to 502 and never forwards www-authenticate', async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(401, {
        'www-authenticate': 'Basic realm="GitHub"',
        'content-type': 'text/plain'
      })
      res.end('bad credentials')
    })
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
    const upPort = (upstream.address() as { port: number }).port
    try {
      await withBridge({ upstreamBase: `http://127.0.0.1:${upPort}` }, async (p) => {
        const res = await send({
          port: p,
          path: `/s/${TOKEN}/acme/api.git/info/refs?service=git-upload-pack`
        })
        expect(res.status).toBe(502)
        expect(res.body).toBe('GitHub credential rejected')
        expect(res.headers['www-authenticate']).toBeUndefined()
      })
    } finally {
      upstream.closeAllConnections()
      await new Promise((r) => upstream.close(r))
    }
  })

  it('treats a throwing approval service as deny', async () => {
    const approval = {
      request: async () => {
        throw new Error('boom')
      },
      revokeSession: () => {}
    } as unknown as ApprovalService
    await withBridge({ approval }, async (p) => {
      const res = await send({
        port: p,
        path: RP,
        method: 'POST',
        headers: RP_TYPE,
        body: createFeatBody()
      })
      expect(res.status).toBe(403)
    })
    expect(receivePackPosts()).toHaveLength(0)
    expect(store.readPushLog(10)[0]).toMatchObject({ result: 'denied' })
  })

  it('answers 502 and logs error when the upstream is unreachable', async () => {
    const probe = http.createServer()
    await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r))
    const deadPort = (probe.address() as { port: number }).port
    await new Promise((r) => probe.close(r))
    await withBridge({ upstreamBase: `http://127.0.0.1:${deadPort}` }, async (p) => {
      const res = await send({
        port: p,
        path: RP,
        method: 'POST',
        headers: RP_TYPE,
        body: createFeatBody()
      })
      expect(res.status).toBe(502)
    })
    expect(store.readPushLog(10)[0]).toMatchObject({
      result: 'error',
      detail: 'upstream unreachable'
    })
  })
})
