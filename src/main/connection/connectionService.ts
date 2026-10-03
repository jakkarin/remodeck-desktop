import { EventEmitter } from 'node:events'
import type { HostStatus } from '../../shared/types'
import type { SandboxTarget } from '../sandbox/target'
import type { ProcResult } from '../proc/run'
import { PREFLIGHT_SCRIPT, parsePreflight } from '../sandbox/preflight'

export type ConnectionDeps = {
  targetFor(hostId: string): SandboxTarget
  checkForward(hostId: string): Promise<boolean>
  onDisconnect(hostId: string): void
}

const NO_GIT =
  'ไม่พบ git บนเครื่องนี้ — ติดตั้งก่อน เช่น sudo apt install git หรือ sudo dnf install git แล้วกด Reload'
const NO_HTTP = 'git บนเครื่องนี้ไม่รองรับ HTTP — push/pull จาก terminal ของแอปจะใช้ไม่ได้'
const NO_FORWARD = 'sshd ปิด AllowTcpForwarding — push/pull จาก terminal ของแอปจะใช้ไม่ได้'

export class ConnectionService extends EventEmitter {
  private readonly statuses = new Map<string, HostStatus>()
  private readonly inFlight = new Map<string, Promise<HostStatus>>()

  constructor(private readonly deps: ConnectionDeps) {
    super()
  }

  status(hostId: string): HostStatus {
    return this.statuses.get(hostId) ?? { state: 'disconnected', warnings: [] }
  }

  connect(hostId: string): Promise<HostStatus> {
    const existing = this.inFlight.get(hostId)
    if (existing) return existing
    const p = this.doConnect(hostId).finally(() => this.inFlight.delete(hostId))
    this.inFlight.set(hostId, p)
    return p
  }

  disconnect(hostId: string): void {
    this.set(hostId, { state: 'disconnected', warnings: [] })
    this.deps.onDisconnect(hostId)
  }

  requireConnected(hostId: string): void {
    if (this.status(hostId).state !== 'connected') throw new Error('Host ยังไม่ได้ connect')
  }

  private set(hostId: string, status: HostStatus): HostStatus {
    this.statuses.set(hostId, status)
    this.emit('status', hostId, status)
    return status
  }

  private async doConnect(hostId: string): Promise<HostStatus> {
    this.set(hostId, { state: 'connecting', warnings: [] })
    const sshFail = (detail: string): HostStatus =>
      this.set(hostId, {
        state: 'error',
        warnings: [],
        error: `${detail}\nลองรัน ssh ${hostId} ใน terminal ของระบบก่อน`
      })

    let r: ProcResult
    try {
      r = await this.deps.targetFor(hostId).exec(PREFLIGHT_SCRIPT)
    } catch (e) {
      return sshFail((e as Error).message)
    }
    if (r.code === 255) return sshFail(r.stderr)

    const { gitVersion, remoteHttp } = parsePreflight(r.stdout)
    if (!gitVersion) return this.set(hostId, { state: 'error', warnings: [], error: NO_GIT })

    const warnings: string[] = []
    if (!remoteHttp) warnings.push(NO_HTTP)
    let forwardOk = false
    try {
      forwardOk = await this.deps.checkForward(hostId)
    } catch {
      forwardOk = false
    }
    if (!forwardOk) warnings.push(NO_FORWARD)
    return this.set(hostId, { state: 'connected', gitVersion, warnings })
  }
}
