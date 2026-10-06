import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContainerService } from '../../../src/main/docker/containerService'
import { DockerError } from '../../../src/main/docker/dockerClient'
import type { ContainerInfo } from '../../../src/shared/containers'

const ID1 = 'a'.repeat(64)
const ID2 = 'b'.repeat(64)
const EVENTS_PATH = '/events?filters=' + encodeURIComponent('{"type":["container"]}')
const LIST_PATH = '/containers/json?all=1'
const refetchPath = (id: string): string =>
  '/containers/json?all=1&filters=' + encodeURIComponent(JSON.stringify({ id: [id] }))

const raw = (id: string, state = 'running'): Record<string, unknown> => ({
  Id: id,
  Names: ['/' + id.slice(0, 4)],
  Image: 'img',
  State: state,
  Status: 'Up',
  Created: 1,
  Ports: [],
  Labels: {}
})

function makeQueue(): {
  lines: AsyncIterable<unknown>
  push(v: unknown): void
  end(): void
  fail(e: Error): void
  close: ReturnType<typeof vi.fn>
} {
  const items: Array<{ v?: unknown; done?: boolean; err?: Error }> = []
  let wake: (() => void) | undefined
  const signal = (): void => {
    wake?.()
    wake = undefined
  }
  const lines = (async function* (): AsyncGenerator<unknown> {
    for (;;) {
      while (!items.length) await new Promise<void>((r) => (wake = r))
      const it = items.shift()!
      if (it.err) throw it.err
      if (it.done) return
      yield it.v
    }
  })()
  const close = vi.fn(() => {
    items.push({ done: true })
    signal()
  })
  return {
    lines,
    close,
    push: (v) => (items.push({ v }), signal()),
    end: () => (items.push({ done: true }), signal()),
    fail: (e) => (items.push({ err: e }), signal())
  }
}

type Queue = ReturnType<typeof makeQueue>

function setup(opts: { streams?: Queue[]; sleep?: (ms: number) => Promise<void> } = {}) {
  const json = vi.fn(async (_m: string, _p: string, _b?: unknown): Promise<unknown> => [])
  const queues = opts.streams ?? []
  let n = 0
  const stream = vi.fn((_p: string) => {
    const q = queues[n++] ?? makeQueue()
    return { lines: q.lines, close: q.close }
  })
  const destroy = vi.fn()
  const client = { json, stream, destroy }
  const sleep = vi.fn(opts.sleep ?? (async () => {}))
  const svc = new ContainerService({
    clientFor: () => client as never,
    sleep
  })
  live.push(() => svc.dispose('h'))
  return { svc, json, stream, destroy, sleep }
}

const live: Array<() => void> = []
afterEach(() => {
  while (live.length) live.pop()!()
})

describe('ContainerService', () => {
  it('lists all containers on open', async () => {
    const t = setup()
    t.json.mockResolvedValueOnce([raw(ID1), raw(ID2, 'exited')])
    const list = await t.svc.open('h')
    expect(t.json).toHaveBeenCalledWith('GET', LIST_PATH)
    expect(list.map((c) => c.id)).toEqual([ID1, ID2])
    expect(list[1].state).toBe('exited')
    await vi.waitFor(() => expect(t.stream).toHaveBeenCalledWith(EVENTS_PATH))
  })

  it('returns the current list on a repeated open', async () => {
    const t = setup()
    t.json.mockResolvedValueOnce([raw(ID1)])
    await t.svc.open('h')
    const again = await t.svc.open('h')
    expect(again.map((c) => c.id)).toEqual([ID1])
    expect(t.json).toHaveBeenCalledTimes(1)
  })

  it('refetches only the container named by an event', async () => {
    const q = makeQueue()
    const t = setup({ streams: [q] })
    t.json.mockResolvedValueOnce([raw(ID1), raw(ID2)])
    await t.svc.open('h')
    const changed = vi.fn()
    t.svc.on('changed', changed)
    t.json.mockResolvedValueOnce([raw(ID1, 'exited')])
    q.push({ Type: 'container', Actor: { ID: ID1 } })
    await vi.waitFor(() => expect(changed).toHaveBeenCalled())
    expect(t.json).toHaveBeenLastCalledWith('GET', refetchPath(ID1))
    const list = changed.mock.calls[0][1] as ContainerInfo[]
    expect(changed.mock.calls[0][0]).toBe('h')
    expect(list.find((c) => c.id === ID1)?.state).toBe('exited')
    expect(list).toHaveLength(2)
  })

  it('ignores events with an invalid id', async () => {
    const q = makeQueue()
    const t = setup({ streams: [q] })
    t.json.mockResolvedValueOnce([raw(ID1)])
    await t.svc.open('h')
    q.push({ Type: 'container', Actor: { ID: 'nope' } })
    q.push({ Type: 'container', id: ID1 })
    await vi.waitFor(() => expect(t.json).toHaveBeenCalledTimes(2))
    expect(t.json).toHaveBeenLastCalledWith('GET', refetchPath(ID1))
  })

  it('drops a container whose refetch is empty', async () => {
    const q = makeQueue()
    const t = setup({ streams: [q] })
    t.json.mockResolvedValueOnce([raw(ID1), raw(ID2)])
    await t.svc.open('h')
    const changed = vi.fn()
    t.svc.on('changed', changed)
    t.json.mockResolvedValueOnce([])
    q.push({ Actor: { ID: ID1 } })
    await vi.waitFor(() => expect(changed).toHaveBeenCalled())
    expect((changed.mock.calls[0][1] as ContainerInfo[]).map((c) => c.id)).toEqual([ID2])
  })

  it('keeps one refetch in flight per container id', async () => {
    const q = makeQueue()
    const t = setup({ streams: [q] })
    t.json.mockResolvedValueOnce([raw(ID1)])
    await t.svc.open('h')
    const resolvers: Array<(v: unknown) => void> = []
    t.json.mockImplementation(() => new Promise((r) => resolvers.push(r)))
    q.push({ Actor: { ID: ID1 } })
    q.push({ Actor: { ID: ID1 } })
    q.push({ Actor: { ID: ID1 } })
    await vi.waitFor(() => expect(resolvers).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(resolvers).toHaveLength(1)
    resolvers[0]([raw(ID1)])
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))
    resolvers[1]([raw(ID1)])
    await new Promise((r) => setTimeout(r, 20))
    expect(resolvers).toHaveLength(2)
  })

  it('reconnects with backoff and relists', async () => {
    const q1 = makeQueue()
    const q2 = makeQueue()
    const q3 = makeQueue()
    const t = setup({ streams: [q1, q2, q3] })
    const liveEvents: boolean[] = []
    t.svc.on('live', (_h: string, v: boolean) => liveEvents.push(v))
    t.json.mockResolvedValue([raw(ID1)])
    await t.svc.open('h')
    await vi.waitFor(() => expect(liveEvents).toEqual([true]))
    const changed = vi.fn()
    t.svc.on('changed', changed)
    q1.end()
    await vi.waitFor(() => expect(t.stream).toHaveBeenCalledTimes(2))
    q2.end()
    await vi.waitFor(() => expect(t.stream).toHaveBeenCalledTimes(3))
    expect(t.sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000])
    await vi.waitFor(() => expect(liveEvents).toEqual([true, false, true, false, true]))
    expect(t.json.mock.calls.filter((c) => c[1] === LIST_PATH).length).toBe(3)
    expect(changed).toHaveBeenCalled()
  })

  it('backoff stays at 10000', async () => {
    const qs = Array.from({ length: 6 }, () => {
      const q = makeQueue()
      q.end()
      return q
    })
    const t = setup({ streams: qs })
    t.json.mockResolvedValue([])
    await t.svc.open('h')
    await vi.waitFor(() => expect(t.sleep.mock.calls.length).toBe(6))
    expect(t.sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 5000, 10000, 10000, 10000])
  })

  it('stops after dispose during backoff', async () => {
    let release: () => void = () => {}
    const q = makeQueue()
    q.end()
    const t = setup({
      streams: [q],
      sleep: () => new Promise<void>((r) => (release = r))
    })
    t.json.mockResolvedValue([])
    await t.svc.open('h')
    await vi.waitFor(() => expect(t.sleep).toHaveBeenCalledTimes(1))
    t.svc.dispose('h')
    release()
    await new Promise((r) => setTimeout(r, 20))
    expect(t.stream).toHaveBeenCalledTimes(1)
    expect(t.destroy).toHaveBeenCalledTimes(1)
  })

  it('dispose is idempotent and closes the stream', async () => {
    const q = makeQueue()
    const t = setup({ streams: [q] })
    t.json.mockResolvedValue([raw(ID1)])
    await t.svc.open('h')
    await vi.waitFor(() => expect(t.stream).toHaveBeenCalled())
    t.svc.dispose('h')
    t.svc.dispose('h')
    expect(q.close).toHaveBeenCalled()
    expect(t.destroy).toHaveBeenCalledTimes(1)
  })

  it('dispose while open is pending does not resurrect state', async () => {
    const t = setup()
    let resolveList: (v: unknown) => void = () => {}
    t.json.mockImplementationOnce(() => new Promise((r) => (resolveList = r)))
    const p = t.svc.open('h').catch(() => 'rejected')
    t.svc.dispose('h')
    resolveList([raw(ID1)])
    await p
    await new Promise((r) => setTimeout(r, 10))
    expect(t.stream).not.toHaveBeenCalled()
  })

  it('rejects open when the initial list fails and retries next time', async () => {
    const t = setup()
    t.json.mockRejectedValueOnce(new Error('boom'))
    await expect(t.svc.open('h')).rejects.toThrow('boom')
    expect(t.stream).not.toHaveBeenCalled()
    t.json.mockResolvedValueOnce([raw(ID1)])
    expect((await t.svc.open('h')).map((c) => c.id)).toEqual([ID1])
  })

  it('rejects an invalid id without calling docker', async () => {
    const t = setup()
    t.json.mockResolvedValue([])
    await t.svc.open('h')
    t.json.mockClear()
    await expect(t.svc.action('h', 'nope', 'stop')).rejects.toThrow()
    expect(t.json).not.toHaveBeenCalled()
  })

  it('maps actions to endpoints and refetches after', async () => {
    const t = setup()
    t.json.mockResolvedValueOnce([raw(ID1)])
    await t.svc.open('h')
    const changed = vi.fn()
    t.svc.on('changed', changed)
    for (const a of ['start', 'stop', 'restart'] as const) {
      t.json.mockClear()
      t.json.mockResolvedValue([raw(ID1)])
      await t.svc.action('h', ID1, a)
      expect(t.json).toHaveBeenNthCalledWith(1, 'POST', `/containers/${ID1}/${a}`)
      expect(t.json).toHaveBeenNthCalledWith(2, 'GET', refetchPath(ID1))
    }
    t.json.mockClear()
    t.json.mockResolvedValueOnce(undefined).mockResolvedValueOnce([])
    await t.svc.action('h', ID1, 'remove')
    expect(t.json).toHaveBeenNthCalledWith(1, 'DELETE', `/containers/${ID1}`)
    expect(changed).toHaveBeenCalled()
    expect((changed.mock.calls.at(-1)![1] as ContainerInfo[]).length).toBe(0)
  })

  it('treats 304 as success', async () => {
    const t = setup()
    t.json.mockResolvedValueOnce([raw(ID1)])
    await t.svc.open('h')
    t.json.mockResolvedValueOnce(undefined).mockResolvedValueOnce([raw(ID1)])
    await expect(t.svc.action('h', ID1, 'start')).resolves.toBeUndefined()
  })

  it('maps 404 and 409-on-remove to Thai messages', async () => {
    const t = setup()
    t.json.mockResolvedValueOnce([raw(ID1)])
    await t.svc.open('h')
    t.json.mockRejectedValueOnce(new DockerError(404, 'No such container'))
    await expect(t.svc.action('h', ID1, 'stop')).rejects.toThrow('container นี้ถูกลบไปแล้ว')
    t.json.mockRejectedValueOnce(
      new DockerError(409, 'You cannot remove a running container abc. Stop it first')
    )
    await expect(t.svc.action('h', ID1, 'remove')).rejects.toThrow(
      'ต้อง stop container ก่อนจึงจะ remove ได้'
    )
    t.json.mockRejectedValueOnce(new DockerError(500, 'daemon exploded'))
    await expect(t.svc.action('h', ID1, 'restart')).rejects.toThrow('daemon exploded')
  })
})
