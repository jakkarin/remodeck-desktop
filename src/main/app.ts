import fs from 'node:fs'
import os from 'node:os'
import { Notification, clipboard, dialog, nativeImage, shell, type BrowserWindow } from 'electron'
import type {
  ApprovalDecision,
  ApprovalRequest,
  Host,
  Prefs,
  Repo,
  Workspace
} from '../shared/types'
import { isLocalHost } from '../shared/types'
import {
  COMPOSE_ACTIONS,
  CONTAINER_ID,
  type ContainerAction,
  type HostTerminalRequest
} from '../shared/containers'
import { RESOURCE_KINDS, type ResourceKind } from '../shared/resources'
import { composeCommand, logsCommand, shellCommand } from './docker/hostCommands'
import { IPC_CHANNELS, type MainApi } from '../shared/ipc'
import { ApprovalService } from './approval/approvalService'
import { GitBridge } from './bridge/gitBridge'
import { ConnectionService } from './connection/connectionService'
import { ContainerService } from './docker/containerService'
import { BuildService } from './docker/buildService'
import { DockerClient } from './docker/dockerClient'
import { localDialStdio, sshDialStdio } from './docker/dialStdio'
import { HostGit } from './git/hostGit'
import { getGitHubCredential } from './github/credentials'
import { GitTokenService } from './gitAccess/gitTokenService'
import { createGithubAdapter } from './gitAccess/providers'
import { SecretStore, electronEncryptor } from './gitAccess/secretStore'
import { TargetAccessService } from './gitAccess/targetAccessService'
import { GitHubClient, compareUrl, parseRepoInput } from './github/githubClient'
import { MirrorService } from './mirror/mirrorService'
import { pickFolder } from './dialogs/pickFolder'
import { resolveBashPath } from './proc/bashPath'
import { resolveSshPath } from './proc/sshPath'
import { checkRemoteForward } from './sandbox/preflight'
import { normalizeLocalPath, validateSandboxPath } from './sandbox/shell'
import { LocalTarget, SshTarget, type SandboxTarget } from './sandbox/target'
import { Store } from './store/store'
import { AutoSync } from './sync/autoSync'
import {
  getDiff,
  listBaseBranches,
  listBranches,
  listCommits,
  listFiles,
  listWorktrees,
  requireCommitInRange,
  resolveBaseRef
} from './sync/queries'
import { SyncService } from './sync/syncService'
import { TerminalService, nodePtySpawner } from './terminal/terminalService'
import { IMAGE_EXTS, MAX_IMAGE_BYTES, type ImageExt } from './terminal/imageUpload'

const EV = IPC_CHANNELS.events

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
export function parseHostPatch(patch: unknown): { label?: string; protected?: boolean } {
  if (
    !isPlainObject(patch) ||
    (patch.label === undefined && patch.protected === undefined) ||
    (patch.label !== undefined && typeof patch.label !== 'string') ||
    (patch.protected !== undefined && typeof patch.protected !== 'boolean')
  )
    throw new Error('Invalid host patch')
  return { label: patch.label, protected: patch.protected }
}
const CONTAINER_ACTIONS: readonly string[] = ['start', 'stop', 'restart', 'remove']

function isTerminalRequest(r: unknown): r is HostTerminalRequest {
  if (!isPlainObject(r)) return false
  if (r.kind === 'build-cache-prune') return true
  if (r.kind === 'resource-prune') return RESOURCE_KINDS.includes(r.resource as ResourceKind)
  if (r.kind === 'logs' || r.kind === 'shell')
    return typeof r.id === 'string' && CONTAINER_ID.test(r.id)
  if (r.kind === 'compose')
    return typeof r.project === 'string' && COMPOSE_ACTIONS.includes(r.action as never)
  return false
}

function checkKind(kind: unknown): ResourceKind {
  if (!RESOURCE_KINDS.includes(kind as ResourceKind)) throw new Error('Invalid resource kind')
  return kind as ResourceKind
}

export function containersApi(deps: {
  hostOf(id: string): Host
  connection: Pick<ConnectionService, 'requireConnected' | 'probeDocker'>
  service: Pick<
    ContainerService,
    | 'open'
    | 'action'
    | 'find'
    | 'project'
    | 'inspect'
    | 'watchStats'
    | 'resources'
    | 'removeResource'
  >
  terminal: Pick<TerminalService, 'openHost'>
  builds: Pick<BuildService, 'history'>
}): MainApi['containers'] {
  return {
    open: async (hostId) => {
      deps.hostOf(hostId)
      deps.connection.requireConnected(hostId)
      const cap = await deps.connection.probeDocker(hostId)
      if (cap.state !== 'ok') throw new Error(cap.detail)
      // The host may have disconnected while the probe was running.
      deps.connection.requireConnected(hostId)
      return deps.service.open(hostId)
    },
    action: async (hostId, id, action) => {
      deps.hostOf(hostId)
      deps.connection.requireConnected(hostId)
      if (!CONTAINER_ACTIONS.includes(action as string)) throw new Error('Invalid container action')
      return deps.service.action(hostId, id, action as ContainerAction)
    },
    inspect: async (hostId, id) => {
      deps.hostOf(hostId)
      deps.connection.requireConnected(hostId)
      return deps.service.inspect(hostId, id)
    },
    resources: async (hostId, kind) => {
      deps.hostOf(hostId)
      deps.connection.requireConnected(hostId)
      return deps.service.resources(hostId, checkKind(kind))
    },
    removeResource: async (hostId, kind, ref) => {
      deps.hostOf(hostId)
      deps.connection.requireConnected(hostId)
      const k = checkKind(kind)
      if (typeof ref !== 'string') throw new Error('Invalid resource ref')
      return deps.service.removeResource(hostId, k, ref)
    },
    buildHistory: async (hostId) => {
      deps.hostOf(hostId)
      deps.connection.requireConnected(hostId)
      return deps.builds.history(hostId)
    },
    watchStats: (hostId, on) => {
      try {
        deps.hostOf(hostId)
        deps.connection.requireConnected(hostId)
        if (typeof on !== 'boolean') return
        deps.service.watchStats(hostId, on)
      } catch {
        // unknown or disconnected host: nothing to watch
      }
    },
    openTerminal: async (hostId, req) => {
      deps.hostOf(hostId)
      deps.connection.requireConnected(hostId)
      if (!isTerminalRequest(req)) throw new Error('Invalid terminal request')
      if (req.kind === 'build-cache-prune') {
        return deps.terminal.openHost(hostId, 'docker buildx prune --force', 'prune · build cache')
      }
      if (req.kind === 'resource-prune') {
        return deps.terminal.openHost(
          hostId,
          `docker ${req.resource} prune --force`,
          `prune · ${req.resource}s`
        )
      }
      if (req.kind === 'compose') {
        const p = deps.service.project(hostId, req.project)
        if (!p) throw new Error('Compose project not found')
        return deps.terminal.openHost(
          hostId,
          composeCommand(p, req.action, { local: isLocalHost(deps.hostOf(hostId)) }),
          `${req.action} · ${p.name}`
        )
      }
      const c = deps.service.find(hostId, req.id)
      if (!c) throw new Error('Container not found')
      return req.kind === 'logs'
        ? deps.terminal.openHost(hostId, logsCommand(c.id), `logs · ${c.name}`)
        : deps.terminal.openHost(hostId, shellCommand(c.id), `sh · ${c.name}`)
    }
  }
}

/** Forwards container-service events to the renderer and tears the service down on disconnect. */
export function wireContainerService(
  service: Pick<ContainerService, 'on' | 'dispose'>,
  send: (channel: string, ...args: unknown[]) => void
): { onDisconnect(hostId: string): void } {
  service.on('changed', (hostId, list) => send(EV['containers-changed'], hostId, list))
  service.on('live', (hostId, live) => send(EV['containers-live'], hostId, live))
  service.on('stats', (hostId, map) => send(EV['containers-stats'], hostId, map))
  return { onDisconnect: (hostId) => service.dispose(hostId) }
}

// ApprovalService gives up after 60 s; drop our side of an unanswered prompt shortly after.
const PROMPT_CLEANUP_MS = 65_000

export async function createApp(opts: {
  dataDir: string
  window: () => BrowserWindow | null
  /** Overrides for end-to-end tests only. */
  sshPath?: string
  githubBase?: string
}): Promise<{ api: MainApi; dispose(): Promise<void> }> {
  const sshPath = opts.sshPath ?? resolveSshPath()
  const githubBase = (opts.githubBase ?? 'https://github.com').replace(/\/+$/, '')
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
    if (!h) throw new Error('Host not found')
    return h
  }
  const wsOf = (id: string): Workspace => {
    const w = store.config.workspaces.find((x) => x.id === id)
    if (!w) throw new Error('Workspace not found')
    return w
  }
  const repoOf = (id: string): Repo => {
    const r = store.config.repos.find((x) => x.id === id)
    if (!r) throw new Error('Repo not found')
    return r
  }
  const bashPath = resolveBashPath()
  const targetFor = (hostId: string): SandboxTarget => {
    const host = hostOf(hostId)
    return isLocalHost(host)
      ? new LocalTarget(os.homedir(), bashPath)
      : new SshTarget(host.sshHost, sshPath)
  }
  const sshHostFor = (hostId: string): string => hostOf(hostId).sshHost

  const adapters = [createGithubAdapter()]
  const gitTokens = new GitTokenService({
    store,
    secrets: new SecretStore(opts.dataDir, electronEncryptor()),
    adapters
  })
  const gitAccess = new TargetAccessService({ store, tokens: gitTokens, adapters, targetFor })

  const mirror = new MirrorService(git, (repo) => `${githubBase}/${repo.owner}/${repo.name}.git`)
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
      if (minimized) notify('remodeck: push approval needed', `${req.repoLabel} — ${req.tabLabel}`)
    })
  const approval = new ApprovalService({ store, prompt, notify: (msg) => notify('remodeck', msg) })

  const bridge = new GitBridge({ upstreamBase: githubBase, credential, approval, store })
  const bridgePort = await bridge.start()

  // One DockerClient per host, created lazily by the service; service.dispose destroys it.
  const containerService = new ContainerService({
    clientFor: (hostId) =>
      new DockerClient({
        connect: () =>
          isLocalHost(hostOf(hostId)) ? localDialStdio() : sshDialStdio(sshPath, sshHostFor(hostId))
      })
  })
  const containerWiring = wireContainerService(containerService, send)
  let terminal: TerminalService | null = null
  const connection = new ConnectionService({
    targetFor,
    sshHostFor,
    isLocal: (hostId) => isLocalHost(hostOf(hostId)),
    checkForward: (hostId) => checkRemoteForward(sshPath, sshHostFor(hostId)),
    onDisconnect: (hostId) => {
      terminal?.closeAllForHost(hostId)
      containerWiring.onDisconnect(hostId)
    }
  })
  terminal = new TerminalService({
    sshPath,
    bashPath,
    homeDir: os.homedir(),
    bridgePort: () => bridgePort,
    spawn: nodePtySpawner(),
    store,
    bridge,
    approval,
    connection,
    targetFor
  })
  const term = terminal

  connection.on('status', (hostId, status) => send(EV['host-status'], hostId, status))
  term.on('data', (tabId, d) => send(EV['terminal-data'], tabId, d))
  term.on('exit', (tabId, code) => send(EV['terminal-exit'], tabId, code))

  const findBranch = async (
    ws: Workspace,
    branch: string,
    baseBranch?: string
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
    if (!b) throw new Error(`Branch not found: ${branch}`)
    const base =
      baseBranch === undefined
        ? `refs/remotes/${b.base}`
        : await resolveBaseRef(git, store.mirrorPath(repo), baseBranch)
    return { base, ref: `refs/remotes/ws-${ws.id}/${branch}` }
  }

  const autoSync = new AutoSync({
    light: (id) => sync.fetchSandbox(wsOf(id)),
    full: (id) => sync.sync(wsOf(id)),
    canSync: (id) => {
      const ws = store.config.workspaces.find((w) => w.id === id)
      return !!ws && connection.status(ws.hostId).state === 'connected'
    },
    onSynced: (id, info) => send(EV['workspace-synced'], id, info)
  })
  term.on('idle', (wsId) => autoSync.idle(wsId))

  const api: MainApi = {
    hosts: {
      list: async () => store.config.hosts,
      add: async (sshHost, label) => store.addHost(sshHost.trim(), label.trim() || sshHost.trim()),
      remove: async (id) => {
        store.removeHost(id)
        containerService.dispose(id)
        if (connection.status(id).state !== 'disconnected') connection.disconnect(id)
      },
      update: async (id, patch) => {
        return store.updateHost(id, parseHostPatch(patch))
      },
      status: async (id) => connection.status(id),
      connect: async (id) => {
        hostOf(id)
        return connection.connect(id)
      },
      probeGit: async (id, force) => {
        hostOf(id)
        return connection.probeGit(id, force === true)
      },
      probeDocker: async (id, force) => {
        hostOf(id)
        return connection.probeDocker(id, force === true)
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
        if (!parsed) throw new Error('Invalid repo format')
        const local = isLocalHost(hostOf(hostId))
        validateSandboxPath(sandboxPath, { local })
        connection.requireConnected(hostId)
        const repo = store.upsertRepo(parsed.owner, parsed.name)
        // Progress events keep the path as typed: the renderer matches them against its input.
        const stored = local ? normalizeLocalPath(sandboxPath, os.homedir()) : sandboxPath
        const ws = store.addWorkspace(repo.id, hostId, stored)
        try {
          await sync.cloneToSandbox(ws, (p) => send(EV['clone-progress'], hostId, sandboxPath, p))
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
      inspectExisting: async (hostId, sandboxPath) => {
        validateSandboxPath(sandboxPath, { local: isLocalHost(hostOf(hostId)) })
        connection.requireConnected(hostId)
        // Read-only: resolves owner/name from the sandbox's origin; nothing is written or fetched.
        return sync.describeExisting(hostId, sandboxPath)
      },
      addExisting: async (hostId, sandboxPath, expected) => {
        validateSandboxPath(sandboxPath, { local: isLocalHost(hostOf(hostId)) })
        connection.requireConnected(hostId)
        // Rejects duplicates and a changed origin before any write, then rolls back only our own records on failure.
        return sync.addExisting(hostId, sandboxPath, expected)
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
        sync.clearRewritten(id)
        return autoSync.syncNow(id)
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
      baseBranches: async (id) => {
        const ws = wsOf(id)
        return listBaseBranches(git, store.mirrorPath(repoOf(ws.repoId)))
      },
      commits: async (id, branch, baseBranch) => {
        const ws = wsOf(id)
        const { base, ref } = await findBranch(ws, branch, baseBranch)
        return listCommits(git, store.mirrorPath(repoOf(ws.repoId)), base, ref)
      },
      files: async (id, branch, commit, baseBranch) => {
        const ws = wsOf(id)
        const { base, ref } = await findBranch(ws, branch, baseBranch)
        const mirrorPath = store.mirrorPath(repoOf(ws.repoId))
        if (commit) await requireCommitInRange(git, mirrorPath, base, ref, commit)
        return listFiles(git, mirrorPath, base, ref, commit)
      },
      diff: async (id, branch, opts) => {
        const ws = wsOf(id)
        const { base, ref } = await findBranch(ws, branch, opts?.base)
        const mirrorPath = store.mirrorPath(repoOf(ws.repoId))
        if (opts?.commit) await requireCommitInRange(git, mirrorPath, base, ref, opts.commit)
        return getDiff(git, mirrorPath, base, ref, opts)
      },
      setActive: (id) => autoSync.setActive(id),
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
      close: (tabId) => term.close(tabId),
      pasteImage: async (tabId) => {
        for (const item of await clipboard.read()) {
          const type = item.types.includes('image/png')
            ? 'image/png'
            : item.types.find((value): value is `image/${string}` => value.startsWith('image/'))
          if (!type) continue
          const blob = await item.getType(type)
          const img = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))
          if (!img.isEmpty()) return term.uploadImage(tabId, new Uint8Array(img.toPNG()), 'png')
        }
        return null
      },
      uploadImage: async (tabId, bytes, ext) => {
        if (!(bytes instanceof Uint8Array)) throw new Error('Invalid image data')
        const e = ext.toLowerCase() === 'jpeg' ? 'jpg' : ext.toLowerCase()
        if (!(IMAGE_EXTS as readonly string[]).includes(e))
          throw new Error('Unsupported image type')
        if (bytes.length === 0) throw new Error('Image is empty')
        if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds 10MB')
        return term.uploadImage(tabId, bytes, e as ImageExt)
      }
    },
    containers: containersApi({
      hostOf,
      connection,
      service: containerService,
      terminal: term,
      builds: new BuildService(targetFor)
    }),
    approval: {
      respond: (requestId, decision) => pending.get(requestId)?.(decision)
    },
    prefs: {
      get: async () => store.config.prefs,
      update: async (patch) => {
        if (!isPlainObject(patch)) throw new Error('Invalid prefs patch')
        const clean: Partial<Prefs> = {}
        if ('theme' in patch) clean.theme = patch.theme as Prefs['theme']
        if ('terminalFontSize' in patch) clean.terminalFontSize = patch.terminalFontSize as number
        if ('defaultProtectedBranches' in patch)
          clean.defaultProtectedBranches = patch.defaultProtectedBranches as string[]
        return store.updatePrefs(clean)
      }
    },
    pushLog: {
      read: async (limit) => store.readPushLog(limit)
    },
    gitTokens: {
      list: async () => store.config.gitTokens,
      add: (input) => gitTokens.add(input),
      replace: (id, token) => gitTokens.replace(id, token),
      setLabel: async (id, label) => gitTokens.setLabel(id, label),
      remove: async (id) => gitTokens.remove(id)
    },
    gitAccess: {
      status: async (hostId) => {
        hostOf(hostId)
        return gitAccess.status(hostId)
      },
      install: async (hostId, tokenIds, opts) => {
        hostOf(hostId)
        // only booleans cross from the renderer; a missing helperFirst keeps the host's earlier choice
        const helperFirst = typeof opts?.helperFirst === 'boolean' ? opts.helperFirst : undefined
        return gitAccess.install(hostId, tokenIds, {
          pathBlock: opts?.pathBlock === true,
          helperFirst
        })
      },
      remove: async (hostId) => {
        hostOf(hostId)
        return gitAccess.remove(hostId)
      }
    },
    dialogs: {
      pickFolder: (start) =>
        pickFolder(
          (o) => {
            const opts = {
              ...o,
              properties: ['openDirectory' as const, 'createDirectory' as const]
            }
            const win = liveWindow()
            return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts)
          },
          start,
          os.homedir()
        )
    }
  }

  const dispose = async (): Promise<void> => {
    autoSync.stop()
    for (const settle of [...pending.values()]) settle('deny')
    for (const h of store.config.hosts) {
      term.closeAllForHost(h.id)
      containerService.dispose(h.id)
    }
    await bridge.stop()
  }

  return { api, dispose }
}
