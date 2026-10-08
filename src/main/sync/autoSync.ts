import type { SyncInfo } from '../../shared/types'

export const LIGHT_MS = 30_000
export const FULL_MS = 300_000

const NOT_CONNECTED = 'Host is not connected'

export type AutoSyncDeps = {
  light(wsId: string): Promise<unknown>
  full(wsId: string): Promise<{ rewritten: string[] }>
  canSync(wsId: string): boolean
  onSynced(wsId: string, info: SyncInfo): void
  now?: () => number
}

type FullResult = { rewritten: string[] }

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export class AutoSync {
  private active: string | null = null
  private lightTimer: ReturnType<typeof setInterval> | null = null
  private fullTimer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<unknown> | null = null
  private queuedFull = new Map<string, Promise<FullResult>>()

  constructor(private readonly deps: AutoSyncDeps) {}

  setActive(wsId: string | null): void {
    this.clearTimers()
    this.active = wsId
    if (wsId === null) return
    this.lightTimer = setInterval(() => this.runLight(wsId), LIGHT_MS)
    this.armFull(wsId)
  }

  idle(wsId: string): void {
    if (wsId !== this.active) return
    this.runLight(wsId)
  }

  syncNow(wsId: string): Promise<FullResult> {
    if (!this.deps.canSync(wsId)) {
      this.deps.onSynced(wsId, { kind: 'full', at: this.at(), error: NOT_CONNECTED })
      return Promise.reject(new Error(NOT_CONNECTED))
    }
    return this.requestFull(wsId)
  }

  stop(): void {
    this.clearTimers()
    this.active = null
  }

  private at(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private clearTimers(): void {
    if (this.lightTimer) clearInterval(this.lightTimer)
    if (this.fullTimer) clearTimeout(this.fullTimer)
    this.lightTimer = null
    this.fullTimer = null
  }

  private armFull(wsId: string): void {
    if (this.fullTimer) clearTimeout(this.fullTimer)
    this.fullTimer = null
    if (this.active !== wsId) return
    this.fullTimer = setTimeout(() => {
      this.fullTimer = null
      this.autoFull(wsId)
    }, FULL_MS)
  }

  private runLight(wsId: string): void {
    if (this.running || !this.deps.canSync(wsId)) return
    const p = (async (): Promise<void> => {
      try {
        await this.deps.light(wsId)
        this.deps.onSynced(wsId, { kind: 'light', at: this.at() })
      } catch (e) {
        this.deps.onSynced(wsId, { kind: 'light', at: this.at(), error: message(e) })
      }
    })().finally(() => {
      if (this.running === p) this.running = null
    })
    this.running = p
  }

  private autoFull(wsId: string): void {
    if (!this.deps.canSync(wsId)) {
      this.armFull(wsId)
      return
    }
    this.requestFull(wsId)
      .catch(() => undefined)
      .finally(() => this.armFull(wsId))
  }

  private requestFull(wsId: string): Promise<FullResult> {
    const queued = this.queuedFull.get(wsId)
    if (queued) return queued
    const prev = this.running ?? Promise.resolve()
    const p: Promise<FullResult> = prev
      .catch(() => undefined)
      .then(() => {
        this.queuedFull.delete(wsId)
        return this.doFull(wsId)
      })
    this.queuedFull.set(wsId, p)
    const tail = p
      .catch(() => undefined)
      .finally(() => {
        if (this.running === tail) this.running = null
      })
    this.running = tail
    return p
  }

  private async doFull(wsId: string): Promise<FullResult> {
    try {
      const result = await this.deps.full(wsId)
      this.deps.onSynced(wsId, { kind: 'full', at: this.at() })
      return result
    } catch (e) {
      this.deps.onSynced(wsId, { kind: 'full', at: this.at(), error: message(e) })
      throw e
    } finally {
      this.armFull(wsId)
    }
  }
}
