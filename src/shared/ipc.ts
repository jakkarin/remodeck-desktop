// Typed IPC contract between main and renderer: types and channel names only, no node imports.
import type { ContainerStats } from './containerDetails'
import type { BuildRecord } from './builds'
import type { PruneResult, ResourceKind, ResourceRow } from './resources'
import type { ContainerAction, ContainerInfo, HostTerminalRequest } from './containers'
import type { GitAccessStatus, GitToken, InstallOptions } from './gitAccess'
import type {
  ApprovalDecision,
  CloneProgress,
  ApprovalRequest,
  BranchInfo,
  BaseBranchInfo,
  CommitInfo,
  ExistingRepoInfo,
  FileChange,
  Host,
  DockerCapability,
  GitCapability,
  HostStatus,
  Prefs,
  PushLogEntry,
  PushOutcome,
  Repo,
  SyncInfo,
  Workspace,
  WorktreeInfo
} from './types'

export type RepoPolicyPatch = Partial<
  Pick<Repo, 'protectedBranches' | 'alwaysAllowPush' | 'enforceRules'>
>

/** Exposed to the renderer as `window.remodeck`. */
export interface RemodeckApi {
  hosts: {
    list(): Promise<Host[]>
    add(sshHost: string, label: string): Promise<Host>
    /** Only the label and protected flag are editable; the ssh host alias is fixed. */
    update(id: string, patch: { label?: string; protected?: boolean }): Promise<Host>
    remove(id: string): Promise<void>
    status(id: string): Promise<HostStatus>
    connect(id: string): Promise<HostStatus>
    /** null = git not installed on the host. Cached per connection; force re-probes. */
    probeGit(id: string, force?: boolean): Promise<GitCapability | null>
    probeDocker(id: string, force?: boolean): Promise<DockerCapability>
    disconnect(id: string): Promise<void>
  }
  repos: {
    listGitHub(): Promise<{ owner: string; name: string; defaultBranch: string }[]>
    list(): Promise<Repo[]>
    updatePolicy(id: string, patch: RepoPolicyPatch): Promise<Repo>
  }
  workspaces: {
    list(): Promise<Workspace[]>
    clone(hostId: string, repoInput: string, sandboxPath: string): Promise<Workspace>
    /** Registers a repo that already exists in the sandbox; never modifies it. */
    inspectExisting(hostId: string, sandboxPath: string): Promise<ExistingRepoInfo>
    addExisting(
      hostId: string,
      sandboxPath: string,
      expected: { owner: string; name: string }
    ): Promise<Workspace>
    remove(id: string, deleteMirrorIfLast: boolean): Promise<void>
    sync(id: string): Promise<{ rewritten: string[] }>
    branches(id: string): Promise<BranchInfo[]>
    baseBranches(id: string): Promise<BaseBranchInfo[]>
    commits(id: string, branch: string, base?: string): Promise<CommitInfo[]>
    files(id: string, branch: string, commit?: string, base?: string): Promise<FileChange[]>
    diff(
      id: string,
      branch: string,
      opts?: { commit?: string; file?: string; base?: string }
    ): Promise<string>
    setActive(id: string | null): void
    worktrees(id: string): Promise<WorktreeInfo[]>
    push(id: string, branch: string, target: string): Promise<PushOutcome>
    openPR(id: string, target: string): Promise<void>
    /** Rebuilds the repo's mirror; with workspaceId, also syncs that workspace if its host is connected. */
    rebuildMirror(repoId: string, workspaceId?: string): Promise<void>
  }
  terminal: {
    open(
      workspaceId: string,
      path?: string
    ): Promise<{ tabId: string; label: string; hostId: string }>
    write(tabId: string, d: string): void
    resize(tabId: string, c: number, r: number): void
    close(tabId: string): void
    /** Uploads the clipboard image to the tab's sandbox; resolves its remote path, or null when the clipboard has no image. */
    pasteImage(tabId: string): Promise<string | null>
    /** Uploads image bytes (png/jpg/jpeg/gif/webp, max 10MB) to the tab's sandbox; resolves the remote path. */
    uploadImage(tabId: string, bytes: Uint8Array, ext: string): Promise<string>
  }
  containers: {
    /** Lists the host's containers and starts live updates; rejects with the probe detail when docker is unusable. */
    open(hostId: string): Promise<{ list: ContainerInfo[]; live: boolean }>
    action(hostId: string, id: string, action: ContainerAction): Promise<void>
    /** Raw `docker inspect` JSON for one container. */
    inspect(hostId: string, id: string): Promise<unknown>
    /** Fresh list of images, volumes or networks (not cached). */
    resources(hostId: string, kind: ResourceKind): Promise<ResourceRow[]>
    removeResource(hostId: string, kind: ResourceKind, ref: string): Promise<void>
    prune(hostId: string, kind: ResourceKind): Promise<PruneResult>
    /** History of the host's current Buildx builder. */
    buildHistory(hostId: string): Promise<BuildRecord[]>
    /** Starts or stops the live CPU/RAM polling for the host's running containers (fire-and-forget). */
    watchStats(hostId: string, on: boolean): void
    /** Opens a logs, shell, compose or prune terminal tab on the host over ssh. */
    openTerminal(
      hostId: string,
      req: HostTerminalRequest
    ): Promise<{ tabId: string; label: string; hostId: string }>
  }
  approval: { respond(requestId: string, decision: ApprovalDecision): void }
  prefs: {
    get(): Promise<Prefs>
    update(patch: Partial<Prefs>): Promise<Prefs>
  }
  pushLog: { read(limit: number): Promise<PushLogEntry[]> }
  /** Token values never leave the main process; every method returns metadata only. */
  gitTokens: {
    list(): Promise<GitToken[]>
    add(input: { host: string; path: string; label: string; token: string }): Promise<GitToken>
    replace(id: string, token: string): Promise<GitToken>
    setLabel(id: string, label: string): Promise<GitToken>
    remove(id: string): Promise<void>
  }
  gitAccess: {
    status(hostId: string): Promise<GitAccessStatus>
    /**
     * opts.pathBlock: the user agreed to edit ~/.bashrc so non-login shells find the gh wrapper.
     * opts.helperFirst: ask remodeck's helper before other credential helpers; omitted keeps the host's choice.
     */
    install(hostId: string, tokenIds: string[], opts?: InstallOptions): Promise<GitAccessStatus>
    remove(hostId: string): Promise<void>
  }
  /** Native folder dialogs; only meaningful for This computer, whose folders live on this machine. */
  dialogs: { pickFolder(start?: string): Promise<string | null> }
  on(event: 'host-status', cb: (hostId: string, s: HostStatus) => void): () => void
  on(event: 'terminal-data', cb: (tabId: string, d: string) => void): () => void
  on(event: 'terminal-exit', cb: (tabId: string, code: number) => void): () => void
  on(event: 'approval-request', cb: (req: ApprovalRequest) => void): () => void
  on(
    event: 'clone-progress',
    cb: (hostId: string, sandboxPath: string, p: CloneProgress) => void
  ): () => void
  on(event: 'workspace-synced', cb: (id: string, info: SyncInfo) => void): () => void
  on(event: 'containers-changed', cb: (hostId: string, list: ContainerInfo[]) => void): () => void
  on(event: 'containers-live', cb: (hostId: string, live: boolean) => void): () => void
  on(
    event: 'containers-stats',
    cb: (hostId: string, stats: Record<string, ContainerStats>) => void
  ): () => void
}

/** Main-side implementation of the API; events are pushed with webContents.send instead of `on`. */
export type MainApi = Omit<RemodeckApi, 'on'>

export type RemodeckEvent =
  | 'host-status'
  | 'terminal-data'
  | 'terminal-exit'
  | 'approval-request'
  | 'workspace-synced'
  | 'clone-progress'
  | 'containers-changed'
  | 'containers-live'
  | 'containers-stats'

export const IPC_CHANNELS = {
  hosts: {
    list: 'hosts:list',
    add: 'hosts:add',
    update: 'hosts:update',
    remove: 'hosts:remove',
    status: 'hosts:status',
    connect: 'hosts:connect',
    probeGit: 'hosts:probeGit',
    probeDocker: 'hosts:probeDocker',
    disconnect: 'hosts:disconnect'
  },
  repos: {
    listGitHub: 'repos:listGitHub',
    list: 'repos:list',
    updatePolicy: 'repos:updatePolicy'
  },
  workspaces: {
    list: 'workspaces:list',
    clone: 'workspaces:clone',
    inspectExisting: 'workspaces:inspectExisting',
    addExisting: 'workspaces:addExisting',
    remove: 'workspaces:remove',
    sync: 'workspaces:sync',
    branches: 'workspaces:branches',
    baseBranches: 'workspaces:baseBranches',
    commits: 'workspaces:commits',
    files: 'workspaces:files',
    diff: 'workspaces:diff',
    setActive: 'workspaces:setActive',
    worktrees: 'workspaces:worktrees',
    push: 'workspaces:push',
    openPR: 'workspaces:openPR',
    rebuildMirror: 'workspaces:rebuildMirror'
  },
  terminal: {
    open: 'terminal:open',
    write: 'terminal:write',
    resize: 'terminal:resize',
    close: 'terminal:close',
    pasteImage: 'terminal:pasteImage',
    uploadImage: 'terminal:uploadImage'
  },
  containers: {
    open: 'containers:open',
    action: 'containers:action',
    openTerminal: 'containers:openTerminal',
    inspect: 'containers:inspect',
    resources: 'containers:resources',
    removeResource: 'containers:removeResource',
    prune: 'containers:prune',
    buildHistory: 'containers:buildHistory',
    watchStats: 'containers:watchStats'
  },
  approval: { respond: 'approval:respond' },
  prefs: { get: 'prefs:get', update: 'prefs:update' },
  pushLog: { read: 'pushLog:read' },
  gitTokens: {
    list: 'gitTokens:list',
    add: 'gitTokens:add',
    replace: 'gitTokens:replace',
    setLabel: 'gitTokens:setLabel',
    remove: 'gitTokens:remove'
  },
  gitAccess: {
    status: 'gitAccess:status',
    install: 'gitAccess:install',
    remove: 'gitAccess:remove'
  },
  dialogs: { pickFolder: 'dialogs:pickFolder' },
  events: {
    'host-status': 'event:host-status',
    'terminal-data': 'event:terminal-data',
    'terminal-exit': 'event:terminal-exit',
    'approval-request': 'event:approval-request',
    'workspace-synced': 'event:workspace-synced',
    'clone-progress': 'event:clone-progress',
    'containers-changed': 'event:containers-changed',
    'containers-live': 'event:containers-live',
    'containers-stats': 'event:containers-stats'
  }
} as const satisfies { [G in keyof MainApi]: { [M in keyof MainApi[G]]: string } } & {
  events: Record<RemodeckEvent, string>
}

/** Fire-and-forget channels (ipcRenderer.send / ipcMain.on); every other method channel is invoke/handle. */
export const SEND_CHANNELS: ReadonlySet<string> = new Set<string>([
  IPC_CHANNELS.workspaces.setActive,
  IPC_CHANNELS.terminal.write,
  IPC_CHANNELS.terminal.resize,
  IPC_CHANNELS.terminal.close,
  IPC_CHANNELS.containers.watchStats,
  IPC_CHANNELS.approval.respond
])
