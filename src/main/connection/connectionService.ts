import { EventEmitter } from 'node:events'
import type { GitCapability, HostStatus } from '../../shared/types'
import type { SandboxTarget } from '../sandbox/target'
import type { ProcResult } from '../proc/run'
import { PREFLIGHT_SCRIPT, parsePreflight } from '../sandbox/preflight'

export type ConnectionDeps = {
  targetFor(hostId: string): SandboxTarget
  sshHostFor(hostId: string): string
  checkForward(hostId: string): Promise<boolean>
  onDisconnect(hostId: string): void
}

export class ConnectionService extends EventEmitter {
  private readonly statuses = new Map<string, HostStatus>()
  private readonly inFlight = new Map<string, Promise<HostStatus>>()
  private readonly generations = new Map<string, number>()
  private readonly caps = new Map<string, GitCapability | null>()
  private readonly probing = new Map<string, Promise<GitCapability | null>>()

  constructor(private readonly deps: ConnectionDeps) {
    super()
  }

  status(hostId: string): HostStatus {
    return this.statuses.get(hostId) ?? { state: 'disconnected' }
  }

  connect(hostId: string): Promise<HostStatus> {
    const existing = this.inFlight.get(hostId)
    if (existing) return existing
    const p = this.doConnect(hostId).finally(() => this.inFlight.delete(hostId))
    this.inFlight.set(hostId, p)
    return p
  }

  disconnect(hostId: string): void {
    this.generations.set(hostId, (this.generations.get(hostId) ?? 0) + 1)
    this.clearProbe(hostId)
    this.set(hostId, { state: 'disconnected' })
    this.deps.onDisconnect(hostId)
  }

  requireConnected(hostId: string): void {
    if (this.status(hostId).state !== 'connected') throw new Error('Host ยังไม่ได้ connect')
  }

  /** null = git is not installed on the host. Cached per connection; `force` re-probes. */
  async probeGit(hostId: string, force = false): Promise<GitCapability | null> {
    this.requireConnected(hostId)
    if (force) this.clearProbe(hostId)
    else {
      if (this.caps.has(hostId)) return Promise.resolve(this.caps.get(hostId) ?? null)
      const existing = this.probing.get(hostId)
      if (existing) return existing
    }
    const p: Promise<GitCapability | null> = this.doProbe(
      hostId,
      () => this.probing.get(hostId) === p
    )
    this.probing.set(hostId, p)
    const clear = (): void => {
      if (this.probing.get(hostId) === p) this.probing.delete(hostId)
    }
    p.then(clear, clear)
    return p
  }

  private clearProbe(hostId: string): void {
    this.caps.delete(hostId)
    this.probing.delete(hostId)
  }

  private async doProbe(hostId: string, current: () => boolean): Promise<GitCapability | null> {
    const r = await this.deps.targetFor(hostId).exec(PREFLIGHT_SCRIPT)
    if (r.code !== 0) throw new Error(r.stderr.trim() || `ssh exit ${r.code}`)
    const { gitVersion, remoteHttp } = parsePreflight(r.stdout)
    let cap: GitCapability | null = null
    if (gitVersion) {
      let forward = false
      try {
        forward = await this.deps.checkForward(hostId)
      } catch {
        forward = false
      }
      cap = { version: gitVersion, remoteHttp, forward }
    }
    if (current()) this.caps.set(hostId, cap)
    return cap
  }

  private set(hostId: string, status: HostStatus): HostStatus {
    this.statuses.set(hostId, status)
    this.emit('status', hostId, status)
    return status
  }

  private async doConnect(hostId: string): Promise<HostStatus> {
    const gen = this.generations.get(hostId) ?? 0
    const stale = (): boolean => (this.generations.get(hostId) ?? 0) !== gen
    this.clearProbe(hostId)
    this.set(hostId, { state: 'connecting' })
    const sshFail = (detail: string): HostStatus =>
      stale()
        ? this.status(hostId)
        : this.set(hostId, {
            state: 'error',
            error: `${detail}\nลองรัน ssh ${this.deps.sshHostFor(hostId)} ใน terminal ของระบบก่อน`
          })

    let r: ProcResult
    try {
      r = await this.deps.targetFor(hostId).exec('true\n')
    } catch (e) {
      return sshFail((e as Error).message)
    }
    if (stale()) return this.status(hostId)
    if (r.code === 255) return sshFail(r.stderr.trim() || 'ssh exit 255')
    if (r.code !== 0) return sshFail(r.stderr.trim() || `ssh exit ${r.code}`)
    return this.set(hostId, { state: 'connected' })
  }
}
