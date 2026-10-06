import { EventEmitter } from 'node:events'
import {
  CONTAINER_ID,
  toContainerInfo,
  type ContainerAction,
  type ContainerInfo
} from '../../shared/containers'
import { DockerError, type DockerClient } from './dockerClient'

const EVENTS_PATH = '/events?filters=' + encodeURIComponent('{"type":["container"]}')
const LIST_PATH = '/containers/json?all=1'
const BACKOFF_MS = [1000, 2000, 5000, 10000]
const STABLE_MS = 30000

const refetchPath = (id: string): string =>
  '/containers/json?all=1&filters=' + encodeURIComponent(JSON.stringify({ id: [id] }))

export interface ContainerServiceDeps {
  clientFor(hostId: string): DockerClient
  sleep?(ms: number): Promise<void>
  now?(): number
}

type HostState = {
  client: DockerClient
  list: Map<string, ContainerInfo>
  ready: boolean
  disposed: boolean
  live: boolean
  stream?: { close(): void }
  opening?: Promise<ContainerInfo[]>
  inflight: Map<string, { dirty: boolean }>
  relisting?: Promise<boolean>
  syncing?: Set<string>
}

function eventId(ev: unknown): string | undefined {
  if (ev === null || typeof ev !== 'object') return undefined
  const e = ev as { Actor?: { ID?: unknown }; id?: unknown }
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

  open(hostId: string): Promise<ContainerInfo[]> {
    const existing = this.hosts.get(hostId)
    if (existing) return existing.opening ?? Promise.resolve(this.snapshot(existing))
    const st: HostState = {
      client: this.deps.clientFor(hostId),
      list: new Map(),
      ready: false,
      disposed: false,
      live: false,
      inflight: new Map()
    }
    this.hosts.set(hostId, st)
    st.opening = (async () => {
      try {
        const raw = await st.client.json<unknown[]>('GET', LIST_PATH)
        if (st.disposed) return []
        this.fill(st, raw)
        st.ready = true
        void this.run(hostId, st)
        return this.snapshot(st)
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
      if (action === 'remove') await st.client.json('DELETE', `/containers/${id}`)
      else await st.client.json('POST', `/containers/${id}/${action}`)
    } catch (e) {
      if (e instanceof DockerError) {
        if (e.status === 404) throw new Error('container นี้ถูกลบไปแล้ว')
        if (e.status === 409 && action === 'remove' && /running/i.test(e.message)) {
          throw new Error('ต้อง stop container ก่อนจึงจะ remove ได้')
        }
        throw new Error(e.message)
      }
      throw e
    }
    await this.refetch(hostId, st, id)
  }

  dispose(hostId: string): void {
    const st = this.hosts.get(hostId)
    if (!st) return
    this.hosts.delete(hostId)
    st.disposed = true
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
    if (st.relisting) return st.relisting
    const p = (async () => {
      try {
        const raw = await st.client.json<unknown[]>('GET', LIST_PATH)
        if (st.disposed) return false
        this.fill(st, raw)
        this.emit('changed', hostId, this.snapshot(st))
        return true
      } catch {
        if (!st.disposed) {
          this.setLive(hostId, st, false)
          try {
            st.stream?.close()
          } catch {
            // already closed
          }
        }
        return false
      } finally {
        st.relisting = undefined
      }
    })()
    st.relisting = p
    return p
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
        if (first === undefined) st.list.delete(id)
        else st.list.set(id, toContainerInfo(first))
        this.emit('changed', hostId, this.snapshot(st))
      } while (flag.dirty && !st.disposed)
    } finally {
      if (st.inflight.get(id) === flag) st.inflight.delete(id)
    }
  }

  private async onOpen(hostId: string, st: HostState, relist: boolean): Promise<void> {
    if (st.disposed) return
    if (!relist) {
      this.setLive(hostId, st, true)
      return
    }
    st.syncing = new Set()
    const ok = await this.fullRelist(hostId, st)
    const dirty = st.syncing
    st.syncing = undefined
    if (st.disposed || !ok) return
    this.setLive(hostId, st, true)
    for (const id of dirty ?? []) void this.refetch(hostId, st, id)
  }

  private async run(hostId: string, st: HostState): Promise<void> {
    let attempt = 0
    let first = true
    while (!st.disposed) {
      const startedAt = this.now()
      let events = 0
      try {
        const stream = st.client.stream(EVENTS_PATH, {
          onOpen: () => {
            const relist = !first
            first = false
            void this.onOpen(hostId, st, relist)
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
