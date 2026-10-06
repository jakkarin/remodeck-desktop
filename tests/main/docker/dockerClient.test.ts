import { afterEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { Duplex } from 'node:stream'
import { spawnDuplex } from '../../../src/main/docker/dialStdio'
import { DockerClient } from '../../../src/main/docker/dockerClient'

let server: http.Server | undefined
let client: DockerClient | undefined
let connections = 0
const sockets = new Set<net.Socket>()

async function start(handler: http.RequestListener, opts: { timeoutMs?: number; idleMs?: number } = {}) {
  connections = 0
  server = http.createServer(handler)
  server.on('connection', (s) => {
    connections++
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  client = new DockerClient({ connect: () => net.connect(port, '127.0.0.1'), ...opts })
  return client
}

afterEach(async () => {
  client?.destroy()
  client = undefined
  for (const s of sockets) s.destroy()
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
  server = undefined
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('DockerClient', () => {
  it('GETs JSON with Host: docker', async () => {
    const c = await start((req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ host: req.headers.host }))
    })
    expect(await c.json('GET', '/version')).toEqual({ host: 'docker' })
  })

  it('POSTs a JSON body', async () => {
    const c = await start((req, res) => {
      let b = ''
      req.on('data', (d) => (b += d))
      req.on('end', () => res.end(JSON.stringify({ ct: req.headers['content-type'], b })))
    })
    expect(await c.json('POST', '/x', { a: 1 })).toEqual({ ct: 'application/json', b: '{"a":1}' })
  })

  it('maps an error body to DockerError', async () => {
    const c = await start((_req, res) => {
      res.statusCode = 404
      res.end(JSON.stringify({ message: 'No such container: abc' }))
    })
    await expect(c.json('GET', '/containers/abc/json')).rejects.toMatchObject({
      status: 404,
      message: 'No such container: abc'
    })
  })

  it('treats 304 as success', async () => {
    const c = await start((_req, res) => {
      res.statusCode = 304
      res.end()
    })
    await expect(c.json('POST', '/containers/x/start')).resolves.toBeUndefined()
  })

  it('resolves undefined for 204', async () => {
    const c = await start((_req, res) => {
      res.statusCode = 204
      res.end()
    })
    await expect(c.json('DELETE', '/containers/x')).resolves.toBeUndefined()
  })

  it('reuses one connection for sequential requests', async () => {
    const c = await start((_req, res) => res.end('{}'))
    await c.json('GET', '/a')
    await c.json('GET', '/b')
    expect(connections).toBe(1)
  })

  it('opens at most 4 connections', async () => {
    const c = await start((_req, res) => setTimeout(() => res.end('{}'), 100))
    await Promise.all(Array.from({ length: 6 }, (_, i) => c.json('GET', `/r${i}`)))
    expect(connections).toBe(4)
  })

  it('closes idle connections after idleMs', async () => {
    const c = await start((_req, res) => res.end('{}'), { idleMs: 50 })
    await c.json('GET', '/a')
    expect(sockets.size).toBe(1)
    await sleep(200)
    expect(sockets.size).toBe(0)
  })

  it('times out a request', async () => {
    const c = await start(() => {}, { timeoutMs: 50 })
    await expect(c.json('GET', '/slow')).rejects.toThrow('docker request timed out')
  })

  it('rejects when the dial stream dies mid-request', async () => {
    const dead = new Duplex({
      read() {},
      write(_chunk, _enc, cb) {
        cb()
        setImmediate(() => dead.destroy(new Error('dial died')))
      }
    })
    client = new DockerClient({ connect: () => dead })
    await expect(client.json('GET', '/x')).rejects.toThrow()
  })

  it('streams JSON lines split across chunks and stops on close', async () => {
    const c = await start((_req, res) => {
      res.write('{"id":"a"}\n{"i')
      setTimeout(() => res.write('d":"b"}\n'), 30)
    })
    const s = c.stream('/events')
    const seen: unknown[] = []
    for await (const l of s.lines) {
      seen.push(l)
      if (seen.length === 2) s.close()
    }
    expect(seen).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('throws DockerError from a non-2xx stream', async () => {
    const c = await start((_req, res) => {
      res.statusCode = 500
      res.end(JSON.stringify({ message: 'bad' }))
    })
    const run = async () => {
      for await (const _ of c.stream('/events').lines) void _
    }
    await expect(run()).rejects.toMatchObject({ status: 500, message: 'bad' })
  })

  it('finishes iteration when the socket ends', async () => {
    const c = await start((_req, res) => res.end('{"x":1}\n'))
    const seen: unknown[] = []
    for await (const l of c.stream('/events').lines) seen.push(l)
    expect(seen).toEqual([{ x: 1 }])
  })

  it('follow-up request succeeds after a timeout', async () => {
    let n = 0
    const c = await start((_req, res) => {
      if (n++ === 0) return
      res.end('{"ok":true}')
    }, { timeoutMs: 100 })
    await expect(c.json('GET', '/slow')).rejects.toThrow('timed out')
    await expect(c.json('GET', '/fast')).resolves.toEqual({ ok: true })
  })

  it('stream closed before iteration opens no connection', async () => {
    const c = await start((_req, res) => res.end('{}'))
    const s = c.stream('/events')
    s.close()
    const seen: unknown[] = []
    for await (const l of s.lines) seen.push(l)
    expect(seen).toEqual([])
    expect(connections).toBe(0)
  })

  describe('over a plain Duplex', () => {
    const plain = (port: number, dials?: { n: number }) => () => {
      if (dials) dials.n++
      const sock = net.connect(port, '127.0.0.1')
      return Duplex.from({ readable: sock, writable: sock }) as Duplex
    }
    const withClient = async (handler: http.RequestListener) => {
      const c = await start(handler)
      client.destroy()
      const port = (server!.address() as AddressInfo).port
      const dials = { n: 0 }
      client = new DockerClient({ connect: plain(port, dials), timeoutMs: 500 })
      return { c: client, dials }
    }

    it('reuses one connection for sequential requests', async () => {
      const { c, dials } = await withClient((_req, res) => res.end('{}'))
      await c.json('GET', '/a')
      await c.json('GET', '/b')
      expect(dials.n).toBe(1)
      expect(connections).toBe(1)
    })

    it('rejects when the stream dies mid-response, then redials', async () => {
      let n = 0
      const { c, dials } = await withClient((req, res) => {
        if (n++ === 0) {
          res.writeHead(200, { 'content-length': '100' })
          res.write('{"a":')
          setTimeout(() => req.socket.destroy(), 20)
          return
        }
        res.end('{"ok":1}')
      })
      await expect(c.json('GET', '/a')).rejects.toThrow()
      await expect(c.json('GET', '/b')).resolves.toEqual({ ok: 1 })
      expect(dials.n).toBe(2)
    })

    it('spawnDuplex child exit after output evicts the socket', async () => {
      const script =
        "process.stdin.once('data',()=>{process.stdout.write('HTTP/1.1 200 OK\\r\\ncontent-length: 2\\r\\n\\r\\n{}');setTimeout(()=>process.exit(0),20)})"
      let dials = 0
      client = new DockerClient({
        connect: () => {
          dials++
          return spawnDuplex(process.execPath, ['-e', script])
        },
        timeoutMs: 2000
      })
      await client.json('GET', '/a')
      await sleep(150)
      await client.json('GET', '/b')
      expect(dials).toBe(2)
    })
  })

  it('does not accumulate close listeners across reuses', async () => {
    const c = await start((_req, res) => res.end('{}'))
    client.destroy()
    const port = (server!.address() as AddressInfo).port
    let sock: net.Socket | undefined
    client = new DockerClient({
      connect: () => (sock = net.connect(port, '127.0.0.1'))
    })
    const warnings: unknown[] = []
    const onWarn = (w: unknown): number => warnings.push(w)
    process.on('warning', onWarn)
    try {
      await client.json('GET', '/0')
      await sleep(0)
      const baseline = sock!.listenerCount('close')
      for (let i = 1; i < 15; i++) await client.json('GET', `/${i}`)
      await sleep(10)
      expect(connections).toBe(1)
      expect(sock!.listenerCount('close')).toBe(baseline)
      expect(warnings).toEqual([])
    } finally {
      process.off('warning', onWarn)
    }
    void c
  })
})
