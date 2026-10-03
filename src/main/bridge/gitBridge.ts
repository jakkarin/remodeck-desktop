import http from 'node:http'
import https from 'node:https'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { PushLogEntry, RefUpdate, Repo } from '../../shared/types'
import type { ApprovalService } from '../approval/approvalService'
import type { Credential } from '../github/credentials'
import type { Store } from '../store/store'
import { parseReceivePackCommands, ReportStatusParser } from './pktline'
import { evaluateRules } from './rules'

export type BridgeSession = {
  token: string
  sessionId: string
  workspaceId: string
  repo: Repo
  tabLabel: string
}

type Deps = {
  upstreamBase?: string
  credential: () => Promise<Credential | null>
  approval: ApprovalService
  store: Store
}

const ROUTE =
  /^\/s\/([A-Za-z0-9_-]+)\/([^/]+)\/([^/]+?)(\.git)?\/(info\/refs|git-upload-pack|git-receive-pack)$/
const FORWARD_HEADERS = ['content-type', 'accept', 'content-encoding', 'git-protocol', 'user-agent']
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'proxy-authenticate',
  'www-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'upgrade'
])
const MAX_COMMAND_BYTES = 1024 * 1024

type Body = AsyncIterable<Buffer> | null

/**
 * Local smart-HTTP proxy to GitHub. Sandboxed terminals reach it through an
 * ssh remote forward; it injects the host's GitHub credential (which never
 * leaves this process), enforces push rules and asks for push approval.
 */
export class GitBridge {
  private readonly sessions = new Map<string, BridgeSession>()
  private readonly upstreamBase: string
  private server: http.Server | null = null

  constructor(private readonly deps: Deps) {
    this.upstreamBase = (deps.upstreamBase ?? 'https://github.com').replace(/\/+$/, '')
  }

  start(): Promise<number> {
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch(() => fail(res, 502, 'bridge error'))
    })
    this.server = server
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
    })
  }

  stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return Promise.resolve()
    return new Promise((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    })
  }

  registerSession(s: BridgeSession): void {
    this.sessions.set(s.token, s)
  }

  revokeSession(token: string): void {
    const s = this.sessions.get(token)
    this.sessions.delete(token)
    if (s) this.deps.approval.revokeSession(s.sessionId)
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const raw = req.url ?? ''
    const q = raw.indexOf('?')
    const pathname = q < 0 ? raw : raw.slice(0, q)
    const query = q < 0 ? '' : raw.slice(q)

    const m = ROUTE.exec(pathname)
    const session = m ? this.sessions.get(m[1]) : undefined
    if (!m || !session) return fail(res, 403, 'forbidden')
    const [, , owner, name, , service] = m
    const repoMatches =
      owner.toLowerCase() === session.repo.owner.toLowerCase() &&
      name.toLowerCase() === session.repo.name.toLowerCase()
    const method = service === 'info/refs' ? 'GET' : 'POST'
    if (!repoMatches || req.method !== method) return fail(res, 403, 'forbidden')
    // Policy can change while a session is open; always use the current one.
    const repo = this.deps.store.config.repos.find((r) => r.id === session.repo.id)
    if (!repo) return fail(res, 403, 'forbidden')

    let credential: Credential | null = null
    try {
      credential = await this.deps.credential()
    } catch {
      credential = null
    }
    if (!credential) return fail(res, 502, 'no GitHub credential')

    const headers: Record<string, string> = {}
    for (const h of FORWARD_HEADERS) {
      const v = req.headers[h]
      if (typeof v === 'string') headers[h] = v
    }
    const basic = Buffer.from(`${credential.username}:${credential.password}`).toString('base64')
    headers.authorization = `Basic ${basic}`
    const target = new URL(`${this.upstreamBase}/${repo.owner}/${repo.name}.git/${service}${query}`)

    if (service !== 'git-receive-pack') {
      await this.forward(target, method, headers, method === 'POST' ? req : null, res)
      return
    }
    // The parser reads raw bytes, so an encoded body could hide its commands.
    const encoding = headers['content-encoding']
    if (encoding !== undefined && encoding.trim().toLowerCase() !== 'identity') {
      this.logPush(session, [], 'blocked', 'unsupported content-encoding')
      return fail(res, 400, 'unsupported content-encoding')
    }
    await this.handleReceivePack(req, res, session, repo, target, headers)
  }

  private async handleReceivePack(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    session: BridgeSession,
    repo: Repo,
    target: URL,
    headers: Record<string, string>
  ): Promise<void> {
    let clientGone = false
    res.on('close', () => {
      if (!res.writableFinished) clientGone = true
    })
    const log = (updates: RefUpdate[], result: PushLogEntry['result'], detail?: string): void =>
      this.logPush(session, updates, result, detail)

    // Buffer the command section; nothing is forwarded until it has been checked.
    const it = req[Symbol.asyncIterator]() as AsyncIterator<Buffer>
    const chunks: Buffer[] = []
    let size = 0
    let commands: RefUpdate[]
    for (;;) {
      let parsed: ReturnType<typeof parseReceivePackCommands>
      try {
        parsed = parseReceivePackCommands(Buffer.concat(chunks, size))
      } catch (err) {
        log([], 'blocked', (err as Error).message)
        return fail(res, 400, 'malformed push request')
      }
      if (parsed) {
        commands = parsed.commands
        break
      }
      if (size > MAX_COMMAND_BYTES) return fail(res, 413, 'push command section too large')
      const next = await it.next()
      if (next.done) {
        log([], 'blocked', 'pkt-line: truncated request')
        return fail(res, 400, 'malformed push request')
      }
      chunks.push(next.value)
      size += next.value.length
    }

    if (commands.length > 0) {
      const verdict = evaluateRules(commands, repo)
      if (!verdict.allowed) {
        log(commands, 'blocked', verdict.reason)
        return fail(res, 403, verdict.reason)
      }
      let approved = false
      try {
        approved = await this.deps.approval.request({
          repoId: session.repo.id,
          repoLabel: `${session.repo.owner}/${session.repo.name}`,
          sessionId: session.sessionId,
          tabLabel: session.tabLabel,
          updates: commands
        })
      } catch {
        approved = false
      }
      if (!approved) {
        log(commands, 'denied')
        return fail(res, 403, 'push denied')
      }
      if (this.sessions.get(session.token) !== session) {
        // Revoked while the prompt was open: drop any grant the answer just created.
        this.deps.approval.revokeSession(session.sessionId)
        log(commands, 'denied', 'session closed')
        return fail(res, 403, 'session closed')
      }
      if (clientGone) return
    }

    async function* body(): AsyncGenerator<Buffer> {
      yield Buffer.concat(chunks, size)
      for (;;) {
        const next = await it.next()
        if (next.done) return
        yield next.value
      }
    }
    // GitHub answers 200 even when it rejects refs: the outcome is in the report-status.
    const report = new ReportStatusParser()
    const status = await this.forward(target, 'POST', headers, body(), res, (c) => report.push(c))
    if (commands.length === 0) return
    if (status !== 200) {
      log(commands, 'error', status === null ? 'upstream unreachable' : `upstream ${status}`)
      return
    }
    const r = report.result()
    if (r.unpack === 'ok' && r.ng.length === 0 && r.fatal === null) {
      log(commands, 'ok')
      return
    }
    const problems: string[] = []
    if (r.unpack === null) problems.push('no report-status from upstream')
    else if (r.unpack !== 'ok') problems.push(`unpack ${r.unpack}`)
    for (const ng of r.ng) problems.push(`ng ${ng.ref} ${ng.reason}`.trim())
    if (r.fatal !== null) problems.push(`fatal ${r.fatal}`)
    log(commands, 'error', problems.join('; '))
  }

  private logPush(
    session: BridgeSession,
    updates: RefUpdate[],
    result: PushLogEntry['result'],
    detail?: string
  ): void {
    this.deps.store.appendPushLog({
      time: new Date().toISOString(),
      repo: `${session.repo.owner}/${session.repo.name}`,
      workspaceId: session.workspaceId,
      channel: 'bridge',
      updates,
      result,
      ...(detail === undefined ? {} : { detail })
    })
  }

  /**
   * Proxies one request upstream and streams the response back. Resolves the upstream status, or null if unreachable.
   * With `tap`, every response chunk is also handed to it (bytes are still forwarded unchanged) and the
   * promise resolves only once the upstream response has finished.
   */
  private forward(
    target: URL,
    method: string,
    headers: Record<string, string>,
    body: Body,
    res: http.ServerResponse,
    tap?: (chunk: Buffer) => void
  ): Promise<number | null> {
    const client = target.protocol === 'https:' ? https : http
    return new Promise((resolve) => {
      const up = client.request(target, { method, headers }, (upRes) => {
        const status = upRes.statusCode ?? 502
        if (status === 401 || status === 407) {
          // Never let sandbox git see an auth challenge: it would prompt for a token there.
          upRes.resume()
          fail(res, 502, 'GitHub credential rejected')
          resolve(status)
          return
        }
        const out: http.OutgoingHttpHeaders = {}
        for (const [k, v] of Object.entries(upRes.headers)) {
          if (v !== undefined && !HOP_BY_HOP.has(k)) out[k] = v
        }
        res.writeHead(status, out)
        if (tap) {
          upRes.on('data', (c: Buffer) => tap(c))
          upRes.on('close', () => resolve(status))
        }
        upRes.pipe(res)
        upRes.on('error', () => res.destroy())
        if (!tap) resolve(status)
      })
      up.on('error', () => {
        fail(res, 502, 'upstream unreachable')
        resolve(null)
      })
      res.on('close', () => {
        if (!res.writableFinished) up.destroy()
      })
      if (!body) {
        up.end()
        return
      }
      // pipeline settles (and cleans up) even if `up` is destroyed without an error.
      pipeline(Readable.from(body), up).catch(() => up.destroy())
    })
  }
}

function fail(res: http.ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' })
  res.end(message)
}
