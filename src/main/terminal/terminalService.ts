import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'
import type { ApprovalService } from '../approval/approvalService'
import type { GitBridge } from '../bridge/gitBridge'
import type { ConnectionService } from '../connection/connectionService'
import type { Store } from '../store/store'
import type { SandboxTarget } from '../sandbox/target'
import { buildHostSshArgs } from '../docker/hostCommands'
import { uploadImage, type ImageExt } from './imageUpload'
import { buildTerminalSshArgs, randomPort } from './sshCommand'

export interface PtyLike {
  onData(cb: (d: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
  write(d: string): void
  resize(c: number, r: number): void
  kill(): void
}

export type PtySpawner = (
  file: string,
  args: string[],
  opts: { cols: number; rows: number }
) => PtyLike

type Deps = {
  sshPath: string
  bridgePort: () => number
  spawn: PtySpawner
  store: Store
  bridge: GitBridge
  approval: ApprovalService
  connection: ConnectionService
  targetFor: (hostId: string) => SandboxTarget
  rand?: () => number
}

type Tab = {
  kind: 'workspace' | 'host'
  hostId: string
  workspaceId: string | null
  token: string
  sessionId: string
  pty: PtyLike | null
  cancelAttempt: () => void
  idleTimer: ReturnType<typeof setTimeout> | null
}

/** Quiet period after the last output before a tab's workspace is reported idle. */
export const IDLE_MS = 3000
const MAX_ATTEMPTS = 5
const RETRY_WINDOW_MS = 3000
const FORWARD_FAILED = 'remote port forwarding failed'
const RETRY_NOTICE = '\r\n[remodeck] tunnel port busy, retrying…\r\n'
const DEFAULT_SIZE = { cols: 80, rows: 24 }

/** Real spawner backed by node-pty; loaded lazily so unit tests never touch the native module. */
export function nodePtySpawner(): PtySpawner {
  return (file, args, opts) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pty = require('node-pty') as typeof import('node-pty')
    const p = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      env: process.env as Record<string, string>
    })
    return {
      onData: (cb) => void p.onData(cb),
      onExit: (cb) => void p.onExit((e) => cb({ exitCode: e.exitCode })),
      write: (d) => p.write(d),
      resize: (c, r) => p.resize(c, r),
      kill: () => p.kill()
    }
  }
}

export type { ImageExt }

export class TerminalService extends EventEmitter {
  private readonly tabs = new Map<string, Tab>()

  constructor(private readonly deps: Deps) {
    super()
  }

  async open(
    workspaceId: string,
    path?: string
  ): Promise<{ tabId: string; label: string; hostId: string }> {
    const { store, connection, bridge } = this.deps
    const ws = store.config.workspaces.find((w) => w.id === workspaceId)
    if (!ws) throw new Error('Workspace not found')
    connection.requireConnected(ws.hostId)
    const host = store.config.hosts.find((h) => h.id === ws.hostId)
    const repo = store.config.repos.find((r) => r.id === ws.repoId)
    if (!host || !repo) throw new Error('Workspace host or repo not found')

    const cwd = path ?? ws.sandboxPath
    const label = `${host.label}:${basename(cwd)}`
    const tabId = crypto.randomUUID()
    const sessionId = crypto.randomUUID()
    const token = crypto.randomBytes(32).toString('base64url')
    const tab: Tab = {
      kind: 'workspace',
      hostId: ws.hostId,
      workspaceId,
      token,
      sessionId,
      pty: null,
      cancelAttempt: () => {},
      idleTimer: null
    }
    this.tabs.set(tabId, tab)
    bridge.registerSession({ token, sessionId, workspaceId, repo, tabLabel: label })

    this.attempt(tabId, tab, host.sshHost, cwd, 1, new Set())
    return { tabId, label, hostId: ws.hostId }
  }

  /** Opens a tab running a remote command on a connected host. No bridge session, idle events or retry. */
  openHost(
    hostId: string,
    remoteCmd: string,
    label: string
  ): { tabId: string; label: string; hostId: string } {
    const { store, connection, spawn, sshPath } = this.deps
    connection.requireConnected(hostId)
    const host = store.config.hosts.find((h) => h.id === hostId)
    if (!host) throw new Error('Host not found')

    const pty = spawn(sshPath, buildHostSshArgs(host.sshHost, remoteCmd), DEFAULT_SIZE)
    const tabId = crypto.randomUUID()
    const tab: Tab = {
      kind: 'host',
      hostId,
      workspaceId: null,
      token: '',
      sessionId: '',
      pty,
      cancelAttempt: () => {},
      idleTimer: null
    }
    this.tabs.set(tabId, tab)
    let cancelled = false
    tab.cancelAttempt = () => {
      cancelled = true
    }
    pty.onData((d) => {
      if (!cancelled) this.emit('data', tabId, d)
    })
    pty.onExit(({ exitCode }) => {
      if (cancelled) return
      cancelled = true
      this.release(tabId, tab)
      this.emit('data', tabId, `\r\n[remodeck] exited with code ${exitCode}\r\n`)
      this.emit('exit', tabId, exitCode)
    })
    return { tabId, label, hostId }
  }

  write(tabId: string, data: string): void {
    this.tabs.get(tabId)?.pty?.write(data)
  }

  resize(tabId: string, cols: number, rows: number): void {
    this.tabs.get(tabId)?.pty?.resize(cols, rows)
  }

  /** Uploads an image to the tab's host and returns its remote path. */
  async uploadImage(tabId: string, bytes: Uint8Array, ext: ImageExt): Promise<string> {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error('Terminal tab not found')
    if (tab.kind === 'host') throw new Error('Images can only be pasted into workspace terminals')
    return uploadImage(this.deps.targetFor(tab.hostId), bytes, ext)
  }

  /** Renderer-initiated close: emits exit -1 so views waiting on the command can finish. */
  close(tabId: string): void {
    this.closeTab(tabId)
  }

  /** Main-initiated (Disconnect, dispose): emits exit -1 per tab so the renderer marks it closed. */
  closeAllForHost(hostId: string): void {
    for (const [id, tab] of [...this.tabs]) {
      if (tab.hostId === hostId) this.closeTab(id)
    }
  }

  /** Main-initiated (workspace removal): emits exit -1 per tab. */
  closeAllForWorkspace(workspaceId: string): void {
    for (const [id, tab] of [...this.tabs]) {
      if (tab.kind === 'workspace' && tab.workspaceId === workspaceId) this.closeTab(id)
    }
  }

  private closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    this.release(tabId, tab)
    tab.cancelAttempt()
    tab.pty?.kill()
    this.emit('exit', tabId, -1)
  }

  private release(tabId: string, tab: Tab): void {
    if (this.tabs.get(tabId) !== tab) return
    this.tabs.delete(tabId)
    if (tab.idleTimer) clearTimeout(tab.idleTimer)
    tab.idleTimer = null
    if (tab.kind === 'host') return
    this.deps.bridge.revokeSession(tab.token)
    this.deps.approval.revokeSession(tab.sessionId)
  }

  private armIdle(tab: Tab): void {
    if (tab.idleTimer) clearTimeout(tab.idleTimer)
    tab.idleTimer = setTimeout(() => {
      tab.idleTimer = null
      this.emit('idle', tab.workspaceId)
    }, IDLE_MS)
  }

  private attempt(
    tabId: string,
    tab: Tab,
    sshHost: string,
    cwd: string,
    n: number,
    usedPorts: Set<number>
  ): void {
    const first = n === 1
    const { deps } = this
    let rport = randomPort(deps.rand)
    while (usedPorts.has(rport)) rport = randomPort(deps.rand)
    usedPorts.add(rport)
    const args = buildTerminalSshArgs({
      sshHost,
      rport,
      bridgePort: deps.bridgePort(),
      token: tab.token,
      path: cwd
    })

    let seen = ''
    let inWindow = true
    let cancelled = false
    let pty: PtyLike
    try {
      pty = deps.spawn(deps.sshPath, args, DEFAULT_SIZE)
    } catch (err) {
      this.release(tabId, tab)
      if (first) throw err
      const msg = err instanceof Error ? err.message : String(err)
      this.emit('data', tabId, `\r\n[remodeck] ${msg}\r\n`)
      this.emit('exit', tabId, -1)
      return
    }
    tab.pty = pty

    const timer = setTimeout(() => {
      inWindow = false
      seen = ''
    }, RETRY_WINDOW_MS)
    tab.cancelAttempt = () => {
      cancelled = true
      clearTimeout(timer)
    }

    pty.onData((d) => {
      if (cancelled) return
      if (inWindow) seen += d
      this.emit('data', tabId, d)
      this.armIdle(tab)
    })
    pty.onExit(({ exitCode }) => {
      if (cancelled) return
      cancelled = true
      clearTimeout(timer)
      if (inWindow && n < MAX_ATTEMPTS && seen.includes(FORWARD_FAILED)) {
        this.emit('data', tabId, RETRY_NOTICE)
        this.attempt(tabId, tab, sshHost, cwd, n + 1, usedPorts)
        return
      }
      this.release(tabId, tab)
      this.emit('exit', tabId, exitCode)
    })
  }
}

function basename(p: string): string {
  const parts = p.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? p
}
