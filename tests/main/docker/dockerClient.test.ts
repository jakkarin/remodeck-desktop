import { afterEach, describe, expect, it } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { Duplex } from 'node:stream'
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
})

