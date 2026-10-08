import { EventEmitter } from 'node:events'
import {
  CONTAINER_ID,
  toContainerInfo,
  type ContainerAction,
  type ContainerInfo,
  type ContainerProject,
  groupContainers
} from '../../shared/containers'
import type { ContainerStats } from '../../shared/containerDetails'
import { DockerError, type DockerClient } from './dockerClient'
import { startStatsLoop } from './statsLoop'

const EVENTS_PATH = '/events?filters=' + encodeURIComponent('{"type":["container"]}')
const LIST_PATH = '/containers/json?all=1'
const BACKOFF_MS = [1000, 2000, 5000, 10000]
const STABLE_MS = 30000
const ACTION_TIMEOUT_MS = 120000
const NOISE_ACTIONS = new Set([
  'attach',
  'resize',
  'top',
  'export',
  'commit',
  'copy',
  'archive-path',
  'extract-to-dir'
])

const refetchPath = (id: string): string =>
  '/containers/json?all=1&filters=' + encodeURIComponent(JSON.stringify({ id: [id] }))

export interface ContainerServiceDeps {
  clientFor(hostId: string): DockerClient
  sleep?(ms: number): Promise<void>
  now?(): number
}

export type OpenResult = { list: ContainerInfo[]; live: boolean }

type HostState = {
  client: DockerClient
  list: Map<string, ContainerInfo>
  ready: boolean
  disposed: boolean
  live: boolean
  stream?: { close(): void }
  opening?: Promise<OpenResult>
  inflight: Map<string, { dirty: boolean }>
  relisting?: { owner: { close(): void } | undefined; promise: Promise<boolean> }
  relistSeq: number
  syncing?: Set<string>
  statsOn?: boolean
  stats?: { stop(): void; done: Promise<void> }
}

function eventId(ev: unknown): string | undefined {
  if (ev === null || typeof ev !== 'object') return undefined
  const e = ev as { Actor?: { ID?: unknown }; id?: unknown; Action?: unknown }
  if (typeof e.Action === 'string') {
    const a = e.Action.split(':')[0].trim()
    if (a.startsWith('exec_') || NOISE_ACTIONS.has(a)) return undefined
  }
  const id = e.Actor?.ID ?? e.id
  return typeof id === 'string' && CONTAINER_ID.test(id) ? id : undefined
}

export class ContainerService extends EventEmitter {
  private readonly hosts = new Map<string, HostState>()
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number

  constructor(private readonly deps: ContainerServiceDeps) {
    super()
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.now = deps.now ?? Date.now
  }

  open(hostId: string): Promise<OpenResult> {
    const existing = this.hosts.get(hostId)
    if (existing) return existing.opening ?? Promise.resolve(this.openResult(existing))
    const st: HostState = {
      client: this.deps.clientFor(hostId),
      list: new Map(),
      ready: false,
      disposed: false,
      live: false,
      inflight: new Map(),
      relistSeq: 0
    }
    this.hosts.set(hostId, st)
    st.opening = (async () => {
      try {
        const raw = await st.client.json<unknown[]>('GET', LIST_PATH)
        if (st.disposed) return { list: [], live: false }
        this.fill(st, raw)
        st.ready = true
        void this.run(hostId, st)
        return this.openResult(st)
      } catch (e) {
        if (!st.disposed) this.dispose(hostId)
        throw e
      } finally {
        st.opening = undefined
      }
    })()
    return st.opening
  }

  async action(hostId: string, id: string, action: ContainerAction): Promise<void> {
    if (!CONTAINER_ID.test(id)) throw new Error('container id ไม่ถูกต้อง')
    const st = this.hosts.get(hostId)
    if (!st || st.disposed) throw new Error('ยังไม่ได้เปิด host นี้')
    try {
      const o = { timeoutMs: ACTION_TIMEOUT_MS }
      if (action === 'remove') await st.client.json('DELETE', `/containers/${id}`, undefined, o)
      else await st.client.json('POST', `/containers/${id}/${action}`, undefined, o)
    } catch (e) {
      if (e instanceof DockerError) {
        if (e.status === 404) {
          await this.refetch(hostId, st, id).catch(() => {})
          throw new Error('container นี้ถูกลบไปแล้ว')
        }
        if (e.status === 409 && action === 'remove' && /running/i.test(e.message)) {
          throw new Error('ต้อง stop container ก่อนจึงจะ remove ได้')
        }
        throw new Error(e.message)
      }
      throw e
    }
    await this.refetch(hostId, st, id)
  }

  watchStats(hostId: string, on: boolean): void {
    const st = this.hosts.get(hostId)
    if (!st || st.disposed) return
    st.statsOn = on
    if (!on) st.stats?.stop()
    // A stopped loop may still have a request in flight; its `done` restarts polling if wanted.
    else if (!st.stats) this.startStats(hostId, st)
  }

  private startStats(hostId: string, st: HostState): void {
    const loop = startStatsLoop({
      client: st.client,
      runningIds: () =>
        this.snapshot(st)
          .filter((c) => c.state === 'running')
          .map((c) => c.id),
      emit: (map: Record<string, ContainerStats>) => {
        if (!st.disposed) this.emit('stats', hostId, map)
      },
      sleep: this.sleep
    })
    st.stats = loop
    void loop.done.catch(() => {}).then(() => {
      if (st.stats === loop) st.stats = undefined
      if (st.statsOn && !st.disposed && !st.stats) this.startStats(hostId, st)
    })
  }

  async inspect(hostId: string, id: string): Promise<unknown> {
    if (!CONTAINER_ID.test(id)) throw new Error('container id ไม่ถูกต้อง')
    const st = this.hosts.get(hostId)
    if (!st || st.disposed) throw new Error('ยังไม่ได้เปิด host นี้')
    try {
      return await st.client.json('GET', `/containers/${id}/json`)
    } catch (e) {
      if (e instanceof DockerError) {
        if (e.status === 404) {
          await this.refetch(hostId, st, id).catch(() => {})
          throw new Error('container นี้ถูกลบไปแล้ว')
        }
        throw new Error(e.message)
      }
      throw e
    }
  }

  find(hostId: string, id: string): ContainerInfo | null {
    const st = this.hosts.get(hostId)
    return st && !st.disposed ? (st.list.get(id) ?? null) : null
  }

  project(hostId: string, name: string): ContainerProject | null {
    const st = this.hosts.get(hostId)
    if (!st || st.disposed) return null
    return groupContainers(this.snapshot(st)).projects.find((p) => p.name === name) ?? null
  }

  dispose(hostId: string): void {
    const st = this.hosts.get(hostId)
    if (!st) return
    this.hosts.delete(hostId)
    st.disposed = true
    st.statsOn = false
    st.stats?.stop()
    st.stats = undefined
    st.list.clear()
    st.inflight.clear()
    try {
      st.stream?.close()
    } catch {
      // already closed
    }
    st.stream = undefined
    st.client.destroy()
  }

  private openResult(st: HostState): OpenResult {
    return { list: this.snapshot(st), live: st.live }
  }

  private snapshot(st: HostState): ContainerInfo[] {
    return [...st.list.values()]
  }

  private fill(st: HostState, raw: unknown): void {
    st.list.clear()
    if (!Array.isArray(raw)) return
    for (const r of raw) {
      const c = toContainerInfo(r)
      if (CONTAINER_ID.test(c.id)) st.list.set(c.id, c)
    }
  }

  private setLive(hostId: string, st: HostState, live: boolean): void {
    if (st.disposed || st.live === live) return
    st.live = live
    this.emit('live', hostId, live)
  }

  /** One coalesced full relist. On failure: live=false and the stream is closed so the loop reconnects. */
  private fullRelist(hostId: string, st: HostState): Promise<boolean> {
    const owner = st.stream
    // Only coalesce with a relist started for the same stream; otherwise start a fresh one.
    if (st.relisting && st.relisting.owner === owner) return st.relisting.promise
    const seq = ++st.relistSeq
    const rec: NonNullable<HostState['relisting']> = { owner, promise: undefined as never }
    rec.promise = (async () => {
      try {
        const raw = await st.client.json<unknown[]>('GET', LIST_PATH)
        if (st.disposed) return false
        if (seq !== st.relistSeq) return true // a newer relist supersedes this data
        this.fill(st, raw)
        this.emit('changed', hostId, this.snapshot(st))
        return true
      } catch {
        if (!st.disposed && st.stream === owner) {
          this.setLive(hostId, st, false)
          try {
            owner?.close()
          } catch {
            // already closed
          }
        }
        return false
      } finally {
        if (st.relisting === rec) st.relisting = undefined
      }
    })()
    st.relisting = rec
    return rec.promise
  }

  private async refetch(hostId: string, st: HostState, id: string): Promise<void> {
    const pending = st.inflight.get(id)
    if (pending) {
      pending.dirty = true
      return
    }
    const flag = { dirty: false }
    st.inflight.set(id, flag)
    try {
      do {
        flag.dirty = false
        let raw: unknown
        try {
          raw = await st.client.json<unknown[]>('GET', refetchPath(id))
        } catch {
          await this.fullRelist(hostId, st)
          return
        }
        if (st.disposed) return
        const first = Array.isArray(raw) ? raw[0] : undefined
        const prev = st.list.get(id)
        if (first === undefined) {
          if (!prev) continue
          st.list.delete(id)
        } else {
          const next = toContainerInfo(first)
          if (prev && JSON.stringify(prev) === JSON.stringify(next)) continue
          st.list.set(id, next)
        }
        this.emit('changed', hostId, this.snapshot(st))
      } while (flag.dirty && !st.disposed)
    } finally {
      if (st.inflight.get(id) === flag) st.inflight.delete(id)
    }
  }

  private async onOpen(hostId: string, st: HostState): Promise<void> {
    if (st.disposed) return
    const mine = st.stream
    const set = new Set<string>()
    st.syncing = set
    const ok = await this.fullRelist(hostId, st)
    if (st.disposed || st.stream !== mine) return // stale: leave a newer stream's set alone
    if (st.syncing === set) st.syncing = undefined
    if (!ok) return
    this.setLive(hostId, st, true)
    for (const id of set) void this.refetch(hostId, st, id)
  }

  private async run(hostId: string, st: HostState): Promise<void> {
    let attempt = 0
    while (!st.disposed) {
      const startedAt = this.now()
      let events = 0
      try {
        const stream = st.client.stream(EVENTS_PATH, {
          onOpen: () => {
            void this.onOpen(hostId, st)
          }
        })
        st.stream = stream
        for await (const ev of stream.lines) {
          if (st.disposed) break
          events++
          const id = eventId(ev)
          if (!id) continue
          if (st.syncing) st.syncing.add(id)
          else void this.refetch(hostId, st, id)
        }
      } catch {
        // fall through to reconnect
      }
      try {
        st.stream?.close()
      } catch {
        // already closed
      }
      st.stream = undefined
      st.syncing = undefined
      if (st.disposed) break
      this.setLive(hostId, st, false)
      if (events > 0 || this.now() - startedAt >= STABLE_MS) attempt = 0
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
      attempt++
      await this.sleep(delay)
    }
  }
}
