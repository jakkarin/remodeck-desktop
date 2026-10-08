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

function makeQueue(noOpen = false): {
  lines: AsyncIterable<unknown>
  push(v: unknown): void
  end(): void
  fail(e: Error): void
  close: ReturnType<typeof vi.fn>
  noOpen: boolean
  onOpen?: () => void
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
    noOpen,
    onOpen: undefined,
    push: (v) => (items.push({ v }), signal()),
    end: () => (items.push({ done: true }), signal()),
    fail: (e) => (items.push({ err: e }), signal())
  }
}

type Queue = ReturnType<typeof makeQueue>

function setup(
  opts: { streams?: Queue[]; sleep?: (ms: number) => Promise<void>; now?: () => number } = {}
) {
  const data = { rows: [] as unknown[], live: false }
  const json = vi.fn(async (_m: string, path: string, _b?: unknown): Promise<unknown> =>
    path === LIST_PATH ? data.rows : []
  )
  const queues = opts.streams ?? []
  let n = 0
  const stream = vi.fn((_p: string, o?: { onOpen?: () => void }) => {
    const q = queues[n++] ?? makeQueue()
    q.onOpen = o?.onOpen
    if (!q.noOpen) queueMicrotask(() => o?.onOpen?.())
    return { lines: q.lines, close: q.close }
  })
  const destroy = vi.fn()
  const client = { json, stream, destroy }
  const sleep = vi.fn(opts.sleep ?? (async () => {}))
  const svc = new ContainerService({
    clientFor: () => client as never,
    sleep,
    now: opts.now
  })
  svc.on('live', (_h: string, v: boolean) => (data.live = v))
  live.push(() => svc.dispose('h'))
  return {
    svc,
    json,
    stream,
    destroy,
    sleep,
    list: (rows: unknown[]) => (data.rows = rows),
    ready: () => vi.waitFor(() => expect(data.live).toBe(true))
  }
}

const live: Array<() => void> = []
afterEach(() => {
  while (live.length) live.pop()!()
})

describe('ContainerService', () => {
  it('lists all containers on open', async () => {
    const t = setup()
    t.json.mockResolvedValueOnce([raw(ID1), raw(ID2, 'exited')])
    const { list } = await t.svc.open('h')
    expect(t.json).toHaveBeenCalledWith('GET', LIST_PATH)
    expect(list.map((c) => c.id)).toEqual([ID1, ID2])
    expect(list[1].state).toBe('exited')
    await vi.waitFor(() => expect(t.stream).toHaveBeenCalledWith(EVENTS_PATH, expect.anything()))
  })

  it('returns the current list on a repeated open', async () => {
    const t = setup()
    t.list([raw(ID1)])
    await t.svc.open('h')
    await t.ready()
    const { list: again } = await t.svc.open('h')
    expect(again.map((c) => c.id)).toEqual([ID1])
    expect(t.json.mock.calls.filter((c) => c[1] === LIST_PATH).length).toBe(2)
  })

  it('refetches only the container named by an event', async () => {
    const q = makeQueue()
    const t = setup({ streams: [q] })
    t.list([raw(ID1), raw(ID2)])
    await t.svc.open('h')
    await t.ready()
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
    t.list([raw(ID1)])
    await t.svc.open('h')
    await t.ready()
    q.push({ Type: 'container', Actor: { ID: 'nope' } })
    q.push({ Type: 'container', id: ID1 })
    await vi.waitFor(() => expect(t.json).toHaveBeenCalledTimes(3))
    expect(t.json).toHaveBeenLastCalledWith('GET', refetchPath(ID1))
  })

  it('drops a container whose refetch is empty', async () => {
    const q = makeQueue()
    const t = setup({ streams: [q] })
    t.list([raw(ID1), raw(ID2)])
    await t.svc.open('h')
    await t.ready()
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
    t.list([raw(ID1)])
    await t.svc.open('h')
    await t.ready()
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
    expect(t.json.mock.calls.filter((c) => c[1] === LIST_PATH).length).toBe(4)
    expect(changed).toHaveBeenCalled()
    for (let i = 1; i < liveEvents.length; i++) expect(liveEvents[i]).not.toBe(liveEvents[i - 1])
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
    await new Promise((r) => setTimeout(r, 20))
    expect(t.stream).toHaveBeenCalledTimes(1)
    expect(t.sleep).not.toHaveBeenCalled()
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
    expect((await t.svc.open('h')).list.map((c) => c.id)).toEqual([ID1])
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
    t.list([raw(ID1)])
    await t.svc.open('h')
    await t.ready()
    const changed = vi.fn()
    t.svc.on('changed', changed)
    for (const a of ['start', 'stop', 'restart'] as const) {
      t.json.mockClear()
      t.json.mockResolvedValue([raw(ID1)])
      await t.svc.action('h', ID1, a)
      expect(t.json).toHaveBeenNthCalledWith(1, 'POST', `/containers/${ID1}/${a}`, undefined, {
        timeoutMs: 120000
      })
      expect(t.json).toHaveBeenNthCalledWith(2, 'GET', refetchPath(ID1))
    }
    t.json.mockClear()
    t.json.mockResolvedValueOnce(undefined).mockResolvedValueOnce([])
    await t.svc.action('h', ID1, 'remove')
    expect(t.json).toHaveBeenNthCalledWith(1, 'DELETE', `/containers/${ID1}`, undefined, {
      timeoutMs: 120000
    })
    expect(changed).toHaveBeenCalled()
    expect((changed.mock.calls.at(-1)![1] as ContainerInfo[]).length).toBe(0)
  })

  it('maps 404 and 409-on-remove to Thai messages', async () => {
    const t = setup()
    t.list([raw(ID1)])
    await t.svc.open('h')
    await t.ready()
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

  it('relists after open and refetches ids that changed during the relist', async () => {
    const q1 = makeQueue()
    const q2 = makeQueue()
    const t = setup({ streams: [q1, q2] })
    t.list([raw(ID1)])
    await t.svc.open('h')
    await t.ready()
    let resolveRelist: (v: unknown) => void = () => {}
    t.json.mockImplementation((_m, path) => {
      if (path === LIST_PATH) return new Promise((r) => (resolveRelist = r))
      return Promise.resolve([raw(ID1, 'exited')])
    })
    q1.end()
    await vi.waitFor(() => expect(t.stream).toHaveBeenCalledTimes(2))
    await vi.waitFor(() =>
      expect(t.json.mock.calls.filter((c) => c[1] === LIST_PATH).length).toBe(3)
    )
    q2.push({ Actor: { ID: ID1 } })
    await new Promise((r) => setTimeout(r, 20))
    expect(t.json.mock.calls.some((c) => c[1] === refetchPath(ID1))).toBe(false)
    const changed = vi.fn()
    t.svc.on('changed', changed)
    resolveRelist([raw(ID1, 'running')])
    await vi.waitFor(() => expect(t.json).toHaveBeenLastCalledWith('GET', refetchPath(ID1)))
    await vi.waitFor(() => {
      const last = changed.mock.calls.at(-1)?.[1] as ContainerInfo[]
      expect(last?.[0].state).toBe('exited')
    })
  })

  it('emits no live value while the stream never opens', async () => {
    const qs = [1, 2, 3, 4].map((i) => {
      const q = makeQueue(true)
      if (i < 4) q.fail(new Error('refused'))
      return q
    })
    const t = setup({ streams: qs })
    const liveEvents: boolean[] = []
    t.svc.on('live', (_h: string, v: boolean) => liveEvents.push(v))
    t.json.mockResolvedValue([])
    await t.svc.open('h')
    await vi.waitFor(() => expect(t.sleep).toHaveBeenCalledTimes(3))
    expect(liveEvents).toEqual([])
  })

  it('relists when an event refetch fails', async () => {
    const q = makeQueue()
    const t = setup({ streams: [q] })
    t.list([raw(ID1)])
    await t.svc.open('h')
    await t.ready()
    const changed = vi.fn()
    t.svc.on('changed', changed)
    t.json.mockImplementation((_m, path) =>
      path === LIST_PATH ? Promise.resolve([raw(ID1, 'exited')]) : Promise.reject(new Error('x'))
    )
    q.push({ Actor: { ID: ID1 } })
    await vi.waitFor(() => expect(changed).toHaveBeenCalled())
    expect((changed.mock.calls.at(-1)![1] as ContainerInfo[])[0].state).toBe('exited')
    expect(t.stream).toHaveBeenCalledTimes(1)
  })

  it('relists when the post-action refetch fails, and action still resolves', async () => {
    const t = setup()
    t.list([raw(ID1)])
    await t.svc.open('h')
    await t.ready()
    t.json.mockImplementation((m, path) => {
      if (m === 'POST') return Promise.resolve(undefined)
      if (path === LIST_PATH) return Promise.resolve([raw(ID1, 'exited')])
      return Promise.reject(new Error('x'))
    })
    const changed = vi.fn()
    t.svc.on('changed', changed)
    await expect(t.svc.action('h', ID1, 'stop')).resolves.toBeUndefined()
    expect(t.json.mock.calls.filter((c) => c[1] === LIST_PATH).length).toBe(3)
    expect((changed.mock.calls.at(-1)![1] as ContainerInfo[])[0].state).toBe('exited')
  })

  it('goes not-live and reconnects when refetch and relist both fail', async () => {
    const q1 = makeQueue()
    const q2 = makeQueue()
    let slept = 0
    const t = setup({
      streams: [q1, q2],
      sleep: () => (slept++ === 0 ? Promise.resolve() : new Promise<void>(() => {}))
    })
    const liveEvents: boolean[] = []
    t.svc.on('live', (_h: string, v: boolean) => liveEvents.push(v))
    t.list([raw(ID1)])
    await t.svc.open('h')
    await t.ready()
    await vi.waitFor(() => expect(liveEvents).toEqual([true]))
    t.json.mockRejectedValue(new Error('down'))
    q1.push({ Actor: { ID: ID1 } })
    await vi.waitFor(() => expect(q1.close).toHaveBeenCalled())
    await vi.waitFor(() => expect(t.stream).toHaveBeenCalledTimes(2))
    expect(liveEvents.slice(0, 2)).toEqual([true, false])
    expect(t.sleep).toHaveBeenCalledWith(1000)
  })

  it('resets backoff after a stream that delivered an event', async () => {
    const q1 = makeQueue()
    const q2 = makeQueue()
    const q3 = makeQueue()
    const q4 = makeQueue()
    const t = setup({ streams: [q1, q2, q3, q4] })
    t.json.mockResolvedValue([])
    await t.svc.open('h')
    q1.end()
    await vi.waitFor(() => expect(t.stream).toHaveBeenCalledTimes(2))
    q2.end()
    await vi.waitFor(() => expect(t.stream).toHaveBeenCalledTimes(3))
    q3.push({ Actor: { ID: ID1 } })
    q3.end()
    await vi.waitFor(() => expect(t.stream).toHaveBeenCalledTimes(4))
    q4.end()
    await vi.waitFor(() => expect(t.sleep).toHaveBeenCalledTimes(4))
    expect(t.sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 1000, 2000])
  })

  it('resets backoff after a stream that stayed open 30s', async () => {
    let clock = 0
    const q1 = makeQueue()
    const q2 = makeQueue()
    const t = setup({ streams: [q1, q2], now: () => clock })
    t.json.mockResolvedValue([])
    await t.svc.open('h')
    q1.end()
    await vi.waitFor(() => expect(t.stream).toHaveBeenCalledTimes(2))
    clock = 30000
    q2.end()
    await vi.waitFor(() => expect(t.sleep).toHaveBeenCalledTimes(2))
    expect(t.sleep.mock.calls.map((c) => c[0])).toEqual([1000, 1000])
  })

  it('shares one list call and one loop between concurrent opens', async () => {
    const t = setup()
    t.json.mockResolvedValue([raw(ID1)])
    const [a, b] = await Promise.all([t.svc.open('h'), t.svc.open('h')])
    expect(a.list.map((c) => c.id)).toEqual([ID1])
    expect(b.list.map((c) => c.id)).toEqual([ID1])
    await new Promise((r) => setTimeout(r, 20))
    expect(t.json.mock.calls.filter((c) => c[1] === LIST_PATH).length).toBe(2)
    expect(t.stream).toHaveBeenCalledTimes(1)
  })

  it('relists on the first open so changes since the initial list are not lost', async () => {
    const q = makeQueue(true)
    const t = setup({ streams: [q] })
    t.list([raw(ID1)])
    await t.svc.open('h')
    const changed = vi.fn()
    t.svc.on('changed', changed)
    t.list([raw(ID1, 'exited'), raw(ID2)])
    await vi.waitFor(() => expect(q.onOpen).toBeDefined())
    q.onOpen!()
    await t.ready()
    const last = changed.mock.calls.at(-1)![1] as ContainerInfo[]
    expect(last.map((c) => [c.id, c.state])).toEqual([
      [ID1, 'exited'],
      [ID2, 'running']
    ])
  })

  it('relists when the first dial fails twice and then opens', async () => {
    const q1 = makeQueue(true)
    const q2 = makeQueue(true)
    q1.fail(new Error('refused'))
    q2.fail(new Error('refused'))
    const q3 = makeQueue()
    const t = setup({ streams: [q1, q2, q3] })
    t.list([raw(ID1)])
    await t.svc.open('h')
    t.list([raw(ID1), raw(ID2)])
    const changed = vi.fn()
    t.svc.on('changed', changed)
    await vi.waitFor(() => expect(t.stream).toHaveBeenCalledTimes(3))
    await t.ready()
    expect(t.sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000])
    expect((changed.mock.calls.at(-1)![1] as ContainerInfo[]).map((c) => c.id)).toEqual([ID1, ID2])
  })

  it('a stale relist failing does not close or de-live a newer stream', async () => {
    const q1 = makeQueue()
    const q2 = makeQueue()
    const t = setup({ streams: [q1, q2] })
    const liveEvents: boolean[] = []
    t.svc.on('live', (_h: string, v: boolean) => liveEvents.push(v))
    t.list([raw(ID1)])
    await t.svc.open('h')
    await t.ready()
    const lists: Array<{ resolve: (v: unknown) => void; reject: (e: Error) => void }> = []
    t.json.mockImplementation((_m, path) => {
      if (path !== LIST_PATH) return Promise.reject(new Error('refetch failed'))
      return new Promise((resolve, reject) => lists.push({ resolve, reject }))
    })
    q1.push({ Actor: { ID: ID1 } })
    await vi.waitFor(() => expect(lists).toHaveLength(1))
    q1.end()
    await vi.waitFor(() => expect(lists).toHaveLength(2))
    lists[0].reject(new Error('old relist failed'))
    lists[1].resolve([raw(ID1)])
    await vi.waitFor(() => expect(liveEvents).toEqual([true, false, true]))
    await new Promise((r) => setTimeout(r, 20))
    expect(q2.close).not.toHaveBeenCalled()
    expect(liveEvents).toEqual([true, false, true])
    expect(t.stream).toHaveBeenCalledTimes(2)
  })

  it('a stale onOpen does not drop the ids collected for a newer stream', async () => {
    const q1 = makeQueue(true)
    const q2 = makeQueue()
    const t = setup({ streams: [q1, q2] })
    t.list([raw(ID1)])
    await t.svc.open('h')
    const lists: Array<(v: unknown) => void> = []
    t.json.mockImplementation((_m, path) => {
      if (path === LIST_PATH) return new Promise((resolve) => lists.push(resolve))
      return Promise.resolve([raw(ID1, 'exited')])
    })
    q1.onOpen!()
    await vi.waitFor(() => expect(lists).toHaveLength(1))
    q1.end()
    await vi.waitFor(() => expect(lists).toHaveLength(2))
    q2.push({ Actor: { ID: ID1 } })
    await new Promise((r) => setTimeout(r, 20))
    const changed = vi.fn()
    t.svc.on('changed', changed)
    lists[0]([raw(ID1, 'running')])
    await new Promise((r) => setTimeout(r, 20))
    lists[1]([raw(ID1, 'running')])
    await vi.waitFor(() => expect(t.json).toHaveBeenLastCalledWith('GET', refetchPath(ID1)))
    await vi.waitFor(() => {
      const last = changed.mock.calls.at(-1)?.[1] as ContainerInfo[]
      expect(last?.[0].state).toBe('exited')
    })
  })

  it('goes not-live, closes the stream and reconnects when the post-open relist fails', async () => {
    const q1 = makeQueue()
    const q2 = makeQueue()
    let slept = 0
    const t = setup({
      streams: [q1, q2],
      sleep: () => (slept++ < 1 ? Promise.resolve() : new Promise<void>(() => {}))
    })
    const liveEvents: boolean[] = []
    t.svc.on('live', (_h: string, v: boolean) => liveEvents.push(v))
    t.list([raw(ID1)])
    await t.svc.open('h')
    await t.ready()
    t.json.mockRejectedValue(new Error('down'))
    q1.end()
    await vi.waitFor(() => expect(q2.close).toHaveBeenCalled())
    await vi.waitFor(() => expect(t.sleep).toHaveBeenCalledTimes(2))
    expect(liveEvents).toEqual([true, false])
    expect(t.sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000])
  })

  it('open reports live=false when the stream never opens, and live=true once it has', async () => {
    const noOpen = setup({ streams: [makeQueue(true)] })
    noOpen.list([raw(ID1)])
    const first = await noOpen.svc.open('h')
    expect(first.live).toBe(false)
    const t = setup()
    t.list([raw(ID1)])
    await t.svc.open('h')
    await t.ready()
    expect((await t.svc.open('h')).live).toBe(true)
  })

  it('ignores exec_*, attach and similar noise events but not health_status', async () => {
    const q = makeQueue()
    const t = setup({ streams: [q] })
    t.list([raw(ID1)])
    await t.svc.open('h')
    await t.ready()
    t.json.mockClear()
    for (const Action of [
      'exec_create: sh',
      'exec_start: sh',
      'exec_die',
      'attach',
      'resize',
      'top',
      'export',
      'commit',
      'copy',
      'archive-path',
      'extract-to-dir'
    ]) {
      q.push({ Type: 'container', Action, Actor: { ID: ID1 } })
    }
    await new Promise((r) => setTimeout(r, 20))
    expect(t.json).not.toHaveBeenCalled()
    q.push({ Type: 'container', Action: 'health_status: healthy', Actor: { ID: ID1 } })
    await vi.waitFor(() => expect(t.json).toHaveBeenCalledWith('GET', refetchPath(ID1)))
  })

  it('does not emit changed when a refetch returns an identical container', async () => {
    const q = makeQueue()
    const t = setup({ streams: [q] })
    t.list([raw(ID1)])
    await t.svc.open('h')
    await t.ready()
    const changed = vi.fn()
    t.svc.on('changed', changed)
    t.json.mockClear()
    t.json.mockResolvedValue([raw(ID1)])
    q.push({ Action: 'health_status: healthy', Actor: { ID: ID1 } })
    await vi.waitFor(() => expect(t.json).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 20))
    expect(changed).not.toHaveBeenCalled()
    t.json.mockResolvedValue([raw(ID1, 'exited')])
    q.push({ Action: 'die', Actor: { ID: ID1 } })
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1))
  })

  it('refetches the id on a 404 so the stale row disappears', async () => {
    const t = setup()
    t.list([raw(ID1)])
    await t.svc.open('h')
    await t.ready()
    const changed = vi.fn()
    t.svc.on('changed', changed)
    t.json.mockClear()
    t.json.mockRejectedValueOnce(new DockerError(404, 'No such container'))
    t.json.mockResolvedValueOnce([])
    await expect(t.svc.action('h', ID1, 'stop')).rejects.toThrow('container นี้ถูกลบไปแล้ว')
    expect(t.json).toHaveBeenLastCalledWith('GET', refetchPath(ID1))
    expect((changed.mock.calls.at(-1)![1] as ContainerInfo[]).length).toBe(0)
  })

  it('find and project read the open list; null when unopened or disposed', async () => {
    const t = setup()
    expect(t.svc.find('h', ID1)).toBeNull()
    expect(t.svc.project('h', 'shop')).toBeNull()
    t.list([
      raw(ID1),
      {
        ...raw(ID2),
        Labels: {
          'com.docker.compose.project': 'shop',
          'com.docker.compose.project.working_dir': '/srv/shop',
          'com.docker.compose.project.config_files': '/srv/shop/compose.yml'
        }
      }
    ])
    await t.svc.open('h')
    expect(t.svc.find('h', ID1)?.id).toBe(ID1)
    expect(t.svc.find('h', 'z'.repeat(64))).toBeNull()
    expect(t.svc.project('h', 'shop')?.containers.map((c) => c.id)).toEqual([ID2])
    expect(t.svc.project('h', 'nope')).toBeNull()
    t.svc.dispose('h')
    expect(t.svc.find('h', ID1)).toBeNull()
    expect(t.svc.project('h', 'shop')).toBeNull()
  })

  describe('stats and inspect', () => {
    const STATS_PATH = (id: string): string => `/containers/${id}/stats?stream=false&one-shot=true`
    const goodStats = {
      cpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 2000, online_cpus: 1 },
      precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 1000 },
      memory_stats: { usage: 1000, limit: 4000 }
    }
    const never = (): Promise<void> => new Promise<void>(() => {})

    it('watchStats emits stats for running containers only', async () => {
      const t = setup({ sleep: never })
      t.list([raw(ID1), raw(ID2, 'exited')])
      await t.svc.open('h')
      t.json.mockImplementation(async (_m, path) =>
        path === LIST_PATH ? [raw(ID1), raw(ID2, 'exited')] : goodStats
      )
      const got = vi.fn()
      t.svc.on('stats', got)
      t.svc.watchStats('h', true)
      t.svc.watchStats('h', true) // idempotent
      await vi.waitFor(() => expect(got).toHaveBeenCalledTimes(1))
      expect(got.mock.calls[0][0]).toBe('h')
      expect(Object.keys(got.mock.calls[0][1])).toEqual([ID1])
      expect(got.mock.calls[0][1][ID1]).toEqual({ cpu: 10, memBytes: 1000, memLimit: 4000 })
      expect(t.json.mock.calls.filter((c) => c[1] === STATS_PATH(ID1)).length).toBe(1)
      expect(t.json.mock.calls.some((c) => c[1] === STATS_PATH(ID2))).toBe(false)
    })

    it('watchStats(false) and dispose stop the loop', async () => {
      let release: () => void = () => {}
      const t = setup({ sleep: () => new Promise<void>((r) => (release = r)) })
      t.list([raw(ID1)])
      await t.svc.open('h')
      t.json.mockImplementation(async (_m, path) => (path === LIST_PATH ? [raw(ID1)] : goodStats))
      const got = vi.fn()
      t.svc.on('stats', got)
      t.svc.watchStats('h', true)
      await vi.waitFor(() => expect(got).toHaveBeenCalledTimes(1))
      t.svc.watchStats('h', false)
      release()
      await new Promise((r) => setTimeout(r, 10))
      expect(got).toHaveBeenCalledTimes(1)
      // restart, then dispose
      t.svc.watchStats('h', true)
      await vi.waitFor(() => expect(got).toHaveBeenCalledTimes(2))
      t.svc.dispose('h')
      release()
      await new Promise((r) => setTimeout(r, 10))
      expect(got).toHaveBeenCalledTimes(2)
    })

    it('watchStats(true) after stop waits for the in-flight request (one at a time)', async () => {
      const t = setup({ sleep: never })
      t.list([raw(ID1)])
      await t.svc.open('h')
      let pending = 0
      let maxPending = 0
      const releases: Array<() => void> = []
      t.json.mockImplementation(async (_m, path) => {
        if (path === LIST_PATH) return [raw(ID1)]
        maxPending = Math.max(maxPending, ++pending)
        await new Promise<void>((r) => releases.push(r))
        pending--
        return goodStats
      })
      const got = vi.fn()
      t.svc.on('stats', got)
      t.svc.watchStats('h', true)
      await vi.waitFor(() => expect(releases.length).toBe(1))
      t.svc.watchStats('h', false)
      t.svc.watchStats('h', true)
      t.svc.watchStats('h', true)
      await new Promise((r) => setTimeout(r, 10))
      expect(releases.length).toBe(1)
      releases[0]()
      await vi.waitFor(() => expect(releases.length).toBe(2))
      expect(maxPending).toBe(1)
      releases[1]()
      await vi.waitFor(() => expect(got).toHaveBeenCalledTimes(1))
    })

    it('watchStats(false) while waiting for the old loop does not restart', async () => {
      const t = setup({ sleep: never })
      t.list([raw(ID1)])
      await t.svc.open('h')
      const releases: Array<() => void> = []
      t.json.mockImplementation(async (_m, path) => {
        if (path === LIST_PATH) return [raw(ID1)]
        await new Promise<void>((r) => releases.push(r))
        return goodStats
      })
      t.svc.watchStats('h', true)
      await vi.waitFor(() => expect(releases.length).toBe(1))
      t.svc.watchStats('h', false)
      t.svc.watchStats('h', true)
      t.svc.watchStats('h', false)
      releases[0]()
      await new Promise((r) => setTimeout(r, 10))
      expect(releases.length).toBe(1)
    })

    it('a rejected loop is cleared so polling restarts', async () => {
      let n = 0
      const t = setup({
        sleep: () => (n++ === 0 ? Promise.reject(new Error('sleep boom')) : never())
      })
      t.list([raw(ID1)])
      await t.svc.open('h')
      t.json.mockImplementation(async (_m, path) => (path === LIST_PATH ? [raw(ID1)] : goodStats))
      const got = vi.fn()
      t.svc.on('stats', got)
      t.svc.watchStats('h', true)
      await vi.waitFor(() => expect(got).toHaveBeenCalledTimes(2))
    })

    it('watchStats on an unopened host is a no-op', async () => {
      const t = setup({ sleep: never })
      expect(() => t.svc.watchStats('h', true)).not.toThrow()
      expect(() => t.svc.watchStats('h', false)).not.toThrow()
      expect(t.json).not.toHaveBeenCalled()
    })

    it('inspect returns raw JSON; 404 maps to Thai message; bad id rejected', async () => {
      const t = setup({ sleep: never })
      t.list([raw(ID1)])
      await t.svc.open('h')
      const body = { Id: ID1, Config: {} }
      t.json.mockImplementation(async (_m, path) =>
        path === `/containers/${ID1}/json` ? body : []
      )
      await expect(t.svc.inspect('h', ID1)).resolves.toBe(body)
      await expect(t.svc.inspect('h', 'bad/../id')).rejects.toThrow('container id ไม่ถูกต้อง')
      await expect(t.svc.inspect('nope', ID1)).rejects.toThrow('ยังไม่ได้เปิด host นี้')
      t.json.mockImplementation(async (_m, path) => {
        if (path === `/containers/${ID1}/json`) throw new DockerError(404, 'no such container')
        return []
      })
      await expect(t.svc.inspect('h', ID1)).rejects.toThrow('container นี้ถูกลบไปแล้ว')
      expect(t.json).toHaveBeenLastCalledWith('GET', refetchPath(ID1))
      t.json.mockImplementation(async () => {
        throw new DockerError(500, 'daemon exploded')
      })
      await expect(t.svc.inspect('h', ID1)).rejects.toThrow('daemon exploded')
    })
  })
})
