import http from 'node:http'
import type { Duplex } from 'node:stream'

export class DockerError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'DockerError'
  }
}

export interface DockerClientOptions {
  connect: () => Duplex
  timeoutMs?: number
  idleMs?: number
}

/** http.Agent only needs a handful of net.Socket methods; stub them for plain Duplex streams. */
function asSocket(d: Duplex): Duplex {
  const s = d as unknown as Record<string, unknown>
  const noop = function (this: Duplex): Duplex {
    return this
  }
  for (const k of ['setTimeout', 'setNoDelay', 'setKeepAlive', 'ref', 'unref']) {
    if (typeof s[k] !== 'function') s[k] = noop
  }
  return d
}

class DialAgent extends http.Agent {
  constructor(
    private readonly dial: () => Duplex,
    opts: http.AgentOptions
  ) {
    super(opts)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createConnection(_options: any, cb?: (err: Error | null, s: Duplex) => void): any {
    const s = asSocket(this.dial())
    if (cb) {
      cb(null, s)
      return undefined
    }
    return s
  }
}

function parseBody(raw: string): unknown {
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function errorFrom(status: number, statusMessage: string | undefined, raw: string): DockerError {
  const parsed = parseBody(raw)
  const msg =
    parsed && typeof parsed === 'object' && typeof (parsed as { message?: unknown }).message === 'string'
      ? (parsed as { message: string }).message
      : undefined
  return new DockerError(status, msg ?? (statusMessage || `HTTP ${status}`))
}

export class DockerClient {
  private readonly agent: DialAgent
  private readonly timeoutMs: number
  private readonly idleMs: number
  private readonly idleTimers = new WeakMap<object, NodeJS.Timeout>()
  private readonly streamAgents = new Set<DialAgent>()

  constructor(private readonly opts: DockerClientOptions) {
    this.timeoutMs = opts.timeoutMs ?? 15000
    this.idleMs = opts.idleMs ?? 60000
    this.agent = new DialAgent(opts.connect, { keepAlive: true, maxSockets: 4 })
    this.agent.on('free', (socket: Duplex) => {
      const t = setTimeout(() => socket.destroy(), this.idleMs)
      t.unref()
      this.idleTimers.set(socket, t)
    })
  }

  private clearIdle(socket: object): void {
    const t = this.idleTimers.get(socket)
    if (t) clearTimeout(t)
    this.idleTimers.delete(socket)
  }

  json<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body)
      const headers: Record<string, string | number> = { Host: 'docker' }
      if (payload !== undefined) {
        headers['Content-Type'] = 'application/json'
        headers['Content-Length'] = Buffer.byteLength(payload)
      }
      let settled = false
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
      }
      const req = http.request({ agent: this.agent, method, path, headers }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('error', (e) => finish(() => reject(e)))
        res.on('aborted', () => finish(() => reject(new Error('docker connection closed'))))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          const status = res.statusCode ?? 0
          finish(() => {
            if (status === 204 || status === 304) return resolve(undefined as T)
            if (status < 200 || status >= 300) return reject(errorFrom(status, res.statusMessage, raw))
            resolve(parseBody(raw) as T)
          })
        })
      })
      const timer = setTimeout(() => {
        finish(() => reject(new Error('docker request timed out')))
        req.socket?.destroy()
        req.destroy()
      }, this.timeoutMs)
      req.on('socket', (s) => this.clearIdle(s))
      req.on('error', (e) => finish(() => reject(e)))
      req.on('close', () => finish(() => reject(new Error('docker connection closed'))))
      req.end(payload)
    })
  }

  stream(path: string): { lines: AsyncIterable<unknown>; close: () => void } {
    const agent = new DialAgent(this.opts.connect, { keepAlive: false })
    this.streamAgents.add(agent)
    let closed = false
    let req: http.ClientRequest | undefined
    const close = (): void => {
      closed = true
      req?.socket?.destroy()
      req?.destroy()
      agent.destroy()
      this.streamAgents.delete(agent)
    }

    const lines = (async function* (): AsyncGenerator<unknown> {
      const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
        req = http.request({ agent, method: 'GET', path, headers: { Host: 'docker' } }, resolve)
        req.on('error', reject)
        req.on('close', () => reject(new Error('docker connection closed')))
        req.end()
      }).catch((e: Error) => {
        if (closed) return undefined
        throw e
      })
      if (!res) return
      const status = res.statusCode ?? 0
      if (status < 200 || status >= 300) {
        const chunks: Buffer[] = []
        for await (const c of res) chunks.push(c as Buffer)
        close()
        throw errorFrom(status, res.statusMessage, Buffer.concat(chunks).toString('utf8'))
      }
      let buf = ''
      try {
        res.setEncoding('utf8')
        for await (const chunk of res as AsyncIterable<string>) {
          buf += chunk
          let i: number
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim()
            buf = buf.slice(i + 1)
            if (line) yield parseBody(line)
          }
        }
        const tail = buf.trim()
        if (tail) yield parseBody(tail)
      } catch (e) {
        if (!closed) throw e
      } finally {
        close()
      }
    })()

    return { lines, close }
  }

  destroy(): void {
    this.agent.destroy()
    for (const a of this.streamAgents) a.destroy()
    this.streamAgents.clear()
  }
}
