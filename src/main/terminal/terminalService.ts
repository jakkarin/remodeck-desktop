import { EventEmitter } from 'node:events'
import crypto from 'node:crypto'
import type { ApprovalService } from '../approval/approvalService'
import type { GitBridge } from '../bridge/gitBridge'
import type { ConnectionService } from '../connection/connectionService'
import type { Store } from '../store/store'
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
  rand?: () => number
}

type Tab = {
  hostId: string
  token: string
  sessionId: string
  pty: PtyLike | null
  cancelAttempt: () => void
}

const MAX_ATTEMPTS = 5
const RETRY_WINDOW_MS = 3000
const FORWARD_FAILED = 'remote port forwarding failed'
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

export class TerminalService extends EventEmitter {
  private readonly tabs = new Map<string, Tab>()

  constructor(private readonly deps: Deps) {
    super()
  }

  async open(workspaceId: string, path?: string): Promise<{ tabId: string; label: string }> {
    const { store, connection, bridge } = this.deps
    const ws = store.config.workspaces.find((w) => w.id === workspaceId)
    if (!ws) throw new Error('ไม่พบ workspace')
    connection.requireConnected(ws.hostId)
    const host = store.config.hosts.find((h) => h.id === ws.hostId)
    const repo = store.config.repos.find((r) => r.id === ws.repoId)
    if (!host || !repo) throw new Error('ไม่พบ host หรือ repo ของ workspace')

    const cwd = path ?? ws.sandboxPath
    const label = `${host.label}:${basename(cwd)}`
    const tabId = crypto.randomUUID()
    const sessionId = crypto.randomUUID()
    const token = crypto.randomBytes(32).toString('base64url')
    const tab: Tab = { hostId: ws.hostId, token, sessionId, pty: null, cancelAttempt: () => {} }
    this.tabs.set(tabId, tab)
    bridge.registerSession({ token, sessionId, workspaceId, repo, tabLabel: label })

    this.attempt(tabId, tab, host.sshHost, cwd, 1, new Set())
    return { tabId, label }
  }

  write(tabId: string, data: string): void {
    this.tabs.get(tabId)?.pty?.write(data)
  }

  resize(tabId: string, cols: number, rows: number): void {
    this.tabs.get(tabId)?.pty?.resize(cols, rows)
  }

  close(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    this.release(tabId, tab)
    tab.cancelAttempt()
    tab.pty?.kill()
  }

  closeAllForHost(hostId: string): void {
    for (const [id, tab] of [...this.tabs]) {
      if (tab.hostId === hostId) this.close(id)
    }
  }

  private release(tabId: string, tab: Tab): void {
    if (this.tabs.get(tabId) !== tab) return
    this.tabs.delete(tabId)
    this.deps.bridge.revokeSession(tab.token)
    this.deps.approval.revokeSession(tab.sessionId)
  }

  private attempt(
    tabId: string,
    tab: Tab,
    sshHost: string,
    cwd: string,
    n: number,
    usedPorts: Set<number>
  ): void {
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

    let buffer = ''
    let streaming = false
    let cancelled = false
    const pty = deps.spawn(deps.sshPath, args, DEFAULT_SIZE)
    tab.pty = pty

    const flush = (): void => {
      streaming = true
      if (buffer) this.emit('data', tabId, buffer)
      buffer = ''
    }
    const timer = setTimeout(() => {
      if (!cancelled) flush()
    }, RETRY_WINDOW_MS)
    tab.cancelAttempt = () => {
      cancelled = true
      clearTimeout(timer)
    }

    pty.onData((d) => {
      if (cancelled) return
      if (streaming) this.emit('data', tabId, d)
      else buffer += d
    })
    pty.onExit(({ exitCode }) => {
      if (cancelled) return
      cancelled = true
      clearTimeout(timer)
      if (!streaming && n < MAX_ATTEMPTS && buffer.includes(FORWARD_FAILED)) {
        this.attempt(tabId, tab, sshHost, cwd, n + 1, usedPorts)
        return
      }
      if (!streaming && buffer) this.emit('data', tabId, buffer)
      this.release(tabId, tab)
      this.emit('exit', tabId, exitCode)
    })
  }
}

function basename(p: string): string {
  const parts = p.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? p
}
