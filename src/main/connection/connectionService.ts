import { EventEmitter } from 'node:events'
import type { DockerCapability, GitCapability, HostStatus } from '../../shared/types'
import type { SandboxTarget } from '../sandbox/target'
import type { ProcResult } from '../proc/run'
import { PREFLIGHT_SCRIPT, parsePreflight } from '../sandbox/preflight'
import { DOCKER_PROBE_SCRIPT, parseDockerProbe } from '../docker/dockerProbe'
import { ProbeCache } from './probeCache'

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
  private readonly gitCache = new ProbeCache<GitCapability | null>()
  private readonly dockerCache = new ProbeCache<DockerCapability>()

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
    return this.gitCache.get(hostId, force, () => this.doProbe(hostId))
  }

  /** Cached per connection; `force` re-probes. Rejects when the ssh run itself fails. */
  async probeDocker(hostId: string, force = false): Promise<DockerCapability> {
    this.requireConnected(hostId)
    return this.dockerCache.get(hostId, force, async () => {
      const r = await this.deps.targetFor(hostId).exec(DOCKER_PROBE_SCRIPT)
      if (r.code !== 0) throw new Error(r.stderr.trim() || `ssh exit ${r.code}`)
      return parseDockerProbe(r.stdout)
    })
  }

  private clearProbe(hostId: string): void {
    this.gitCache.clear(hostId)
    this.dockerCache.clear(hostId)
  }

  private async doProbe(hostId: string): Promise<GitCapability | null> {
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
