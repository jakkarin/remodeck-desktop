import fs from 'node:fs'
import { Notification, shell, type BrowserWindow } from 'electron'
import type { ApprovalDecision, ApprovalRequest, Host, Repo, Workspace } from '../shared/types'
import { IPC_CHANNELS, type MainApi } from '../shared/ipc'
import { ApprovalService } from './approval/approvalService'
import { GitBridge } from './bridge/gitBridge'
import { ConnectionService } from './connection/connectionService'
import { HostGit } from './git/hostGit'
import { getGitHubCredential } from './github/credentials'
import { GitHubClient, compareUrl, parseRepoInput } from './github/githubClient'
import { MirrorService } from './mirror/mirrorService'
import { resolveSshPath } from './proc/sshPath'
import { checkRemoteForward } from './sandbox/preflight'
import { validateSandboxPath } from './sandbox/shell'
import { SshTarget } from './sandbox/target'
import { Store } from './store/store'
import { getDiff, listBranches, listCommits, listWorktrees } from './sync/queries'
import { SyncService } from './sync/syncService'
import { TerminalService, nodePtySpawner } from './terminal/terminalService'

const EV = IPC_CHANNELS.events
// ApprovalService gives up after 60 s; drop our side of an unanswered prompt shortly after.
const PROMPT_CLEANUP_MS = 65_000

export async function createApp(opts: {
  dataDir: string
  window: () => BrowserWindow | null
}): Promise<{ api: MainApi; dispose(): Promise<void> }> {
  const sshPath = resolveSshPath()
  const git = new HostGit({ sshPath })
  const store = new Store(opts.dataDir)

  const liveWindow = (): BrowserWindow | null => {
    const w = opts.window()
    return w && !w.isDestroyed() ? w : null
  }
  const send = (channel: string, ...args: unknown[]): void => {
    liveWindow()?.webContents.send(channel, ...args)
  }
  const notify = (title: string, body: string): void => {
    if (Notification.isSupported()) new Notification({ title, body }).show()
  }

  const hostOf = (id: string): Host => {
    const h = store.config.hosts.find((x) => x.id === id)
    if (!h) throw new Error('ไม่พบ host')
    return h
  }
  const wsOf = (id: string): Workspace => {
    const w = store.config.workspaces.find((x) => x.id === id)
    if (!w) throw new Error('ไม่พบ workspace')
    return w
  }
  const repoOf = (id: string): Repo => {
    const r = store.config.repos.find((x) => x.id === id)
    if (!r) throw new Error('ไม่พบ repo')
    return r
  }
  const targetFor = (hostId: string): SshTarget => new SshTarget(hostOf(hostId).sshHost, sshPath)
  const sshHostFor = (hostId: string): string => hostOf(hostId).sshHost

  const mirror = new MirrorService(
    git,
    (repo) => `https://github.com/${repo.owner}/${repo.name}.git`
  )
  const sync = new SyncService({ git, mirror, store, targetFor })
  const credential = (): ReturnType<typeof getGitHubCredential> => getGitHubCredential(git)
  const github = new GitHubClient(credential)

  // Approval prompts are answered by the renderer through approval.respond.
  const pending = new Map<string, (d: ApprovalDecision) => void>()
  const prompt = (req: ApprovalRequest): Promise<ApprovalDecision> =>
    new Promise((resolve) => {
      const win = liveWindow()
      if (!win) return resolve('deny')
      const settle = (d: ApprovalDecision): void => {
        if (pending.get(req.id) !== settle) return
        pending.delete(req.id)
        clearTimeout(timer)
        resolve(d)
      }
      const timer = setTimeout(() => settle('deny'), PROMPT_CLEANUP_MS)
      pending.set(req.id, settle)
      const minimized = win.isMinimized()
      win.webContents.send(EV['approval-request'], req)
      if (minimized) win.restore()
      win.show()
      win.focus()
      if (minimized) notify('regit: push approval needed', `${req.repoLabel} — ${req.tabLabel}`)
    })
  const approval = new ApprovalService({ store, prompt, notify: (msg) => notify('regit', msg) })

  const bridge = new GitBridge({ credential, approval, store })
  const bridgePort = await bridge.start()

  let terminal: TerminalService | null = null
  const connection = new ConnectionService({
    targetFor,
    sshHostFor,
    checkForward: (hostId) => checkRemoteForward(sshPath, sshHostFor(hostId)),
    onDisconnect: (hostId) => terminal?.closeAllForHost(hostId)
  })
  terminal = new TerminalService({
    sshPath,
    bridgePort: () => bridgePort,
    spawn: nodePtySpawner(),
    store,
    bridge,
    approval,
    connection
  })
  const term = terminal

  connection.on('status', (hostId, status) => send(EV['host-status'], hostId, status))
  term.on('data', (tabId, d) => send(EV['terminal-data'], tabId, d))
  term.on('exit', (tabId, code) => send(EV['terminal-exit'], tabId, code))

  const findBranch = async (
    ws: Workspace,
    branch: string
  ): Promise<{ base: string; ref: string }> => {
    const repo = repoOf(ws.repoId)
    const list = await listBranches(
      git,
      store.mirrorPath(repo),
      ws.id,
      repo.defaultBranch,
      sync.rewrittenBranches(ws.id)
    )
    const b = list.find((x) => x.name === branch)
    if (!b) throw new Error(`ไม่พบ branch ${branch}`)
    return { base: `refs/remotes/${b.base}`, ref: `refs/remotes/ws-${ws.id}/${branch}` }
  }

  const api: MainApi = {
    hosts: {
      list: async () => store.config.hosts,
      add: async (sshHost, label) => store.addHost(sshHost.trim(), label.trim() || sshHost.trim()),
      remove: async (id) => {
        store.removeHost(id)
        if (connection.status(id).state !== 'disconnected') connection.disconnect(id)
      },
      status: async (id) => connection.status(id),
      connect: async (id) => {
        hostOf(id)
        return connection.connect(id)
      },
      disconnect: async (id) => connection.disconnect(id)
    },
    repos: {
      listGitHub: () => github.listRepos(),
      list: async () => store.config.repos,
      updatePolicy: async (id, patch) => {
        const clean: Parameters<Store['updateRepo']>[1] = {}
        if (patch.protectedBranches !== undefined) clean.protectedBranches = patch.protectedBranches
        if (patch.alwaysAllowPush !== undefined) clean.alwaysAllowPush = patch.alwaysAllowPush
        if (patch.enforceRules !== undefined) clean.enforceRules = patch.enforceRules
        return store.updateRepo(id, clean)
      }
    },
    workspaces: {
      list: async () => store.config.workspaces,
      clone: async (hostId, repoInput, sandboxPath) => {
        const parsed = parseRepoInput(repoInput)
        if (!parsed) throw new Error('รูปแบบ repo ไม่ถูกต้อง')
        validateSandboxPath(sandboxPath)
        hostOf(hostId)
        connection.requireConnected(hostId)
        const repo = store.upsertRepo(parsed.owner, parsed.name)
        const ws = store.addWorkspace(repo.id, hostId, sandboxPath)
        try {
          await sync.cloneToSandbox(ws)
        } catch (err) {
          // Undo only our own records; never delete anything in the sandbox.
          store.removeWorkspace(ws.id)
          const mirrorPath = store.mirrorPath(repo)
          if (fs.existsSync(mirrorPath))
            await mirror.removeWorkspace(mirrorPath, ws.id).catch(() => undefined)
          throw err
        }
        return ws
      },
      remove: async (id, deleteMirrorIfLast) => {
        const ws = wsOf(id)
        const repo = repoOf(ws.repoId)
        const mirrorPath = store.mirrorPath(repo)
        // Close its terminals first: revokes their bridge/approval sessions and marks the tabs closed.
        term.closeAllForWorkspace(id)
        // Best effort: a stale remote in the mirror is harmless and fixed by Rebuild mirror.
        if (fs.existsSync(mirrorPath))
          await mirror.removeWorkspace(mirrorPath, id).catch(() => undefined)
        store.removeWorkspace(id)
        const last = !store.config.workspaces.some((w) => w.repoId === repo.id)
        if (last && deleteMirrorIfLast) await mirror.delete(mirrorPath)
      },
      sync: async (id) => {
        const ws = wsOf(id)
        connection.requireConnected(ws.hostId)
        return sync.sync(ws)
      },
      branches: async (id) => {
        const ws = wsOf(id)
        const repo = repoOf(ws.repoId)
        return listBranches(
          git,
          store.mirrorPath(repo),
          id,
          repo.defaultBranch,
          sync.rewrittenBranches(id)
        )
      },
      commits: async (id, branch) => {
        const ws = wsOf(id)
        const { base, ref } = await findBranch(ws, branch)
        return listCommits(git, store.mirrorPath(repoOf(ws.repoId)), base, ref)
      },
      diff: async (id, branch) => {
        const ws = wsOf(id)
        const { base, ref } = await findBranch(ws, branch)
        return getDiff(git, store.mirrorPath(repoOf(ws.repoId)), base, ref)
      },
      worktrees: async (id) => {
        const ws = wsOf(id)
        connection.requireConnected(ws.hostId)
        return listWorktrees(targetFor(ws.hostId), ws.sandboxPath)
      },
      push: async (id, branch, target) => sync.pushToGitHub(wsOf(id), branch, target),
      openPR: async (id, target) => {
        const repo = repoOf(wsOf(id).repoId)
        await shell.openExternal(compareUrl(repo.owner, repo.name, repo.defaultBranch, target))
      },
      rebuildMirror: async (repoId, workspaceId) => {
        const repo = repoOf(repoId)
        const workspaces = store.config.workspaces
          .filter((w) => w.repoId === repoId)
          .map((w) => ({ id: w.id, url: targetFor(w.hostId).gitUrl(w.sandboxPath) }))
        await mirror.rebuild(repo, store.mirrorPath(repo), workspaces)
        // A fresh mirror has no workspace refs until the next sync: refill them now when possible.
        const ws = workspaceId ? wsOf(workspaceId) : null
        if (ws && ws.repoId === repoId && connection.status(ws.hostId).state === 'connected') {
          await sync.sync(ws)
        }
      }
    },
    terminal: {
      open: (workspaceId, path) => term.open(workspaceId, path),
      write: (tabId, d) => term.write(tabId, d),
      resize: (tabId, c, r) => term.resize(tabId, c, r),
      close: (tabId) => term.close(tabId)
    },
    approval: {
      respond: (requestId, decision) => pending.get(requestId)?.(decision)
    },
    pushLog: {
      read: async (limit) => store.readPushLog(limit)
    }
  }

  const dispose = async (): Promise<void> => {
    for (const settle of [...pending.values()]) settle('deny')
    for (const h of store.config.hosts) term.closeAllForHost(h.id)
    await bridge.stop()
  }

  return { api, dispose }
}
