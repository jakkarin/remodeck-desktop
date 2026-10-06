// Typed IPC contract between main and renderer: types and channel names only, no node imports.
import type {
  ApprovalDecision,
  ApprovalRequest,
  BranchInfo,
  CommitInfo,
  ExistingRepoInfo,
  FileChange,
  Host,
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
    /** Only the label is editable; the ssh host alias is fixed. */
    update(id: string, patch: { label: string }): Promise<Host>
    remove(id: string): Promise<void>
    status(id: string): Promise<HostStatus>
    connect(id: string): Promise<HostStatus>
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
    commits(id: string, branch: string): Promise<CommitInfo[]>
    files(id: string, branch: string, commit?: string): Promise<FileChange[]>
    diff(id: string, branch: string, opts?: { commit?: string; file?: string }): Promise<string>
    setActive(id: string | null): void
    worktrees(id: string): Promise<WorktreeInfo[]>
    push(id: string, branch: string, target: string): Promise<PushOutcome>
    openPR(id: string, target: string): Promise<void>
    /** Rebuilds the repo's mirror; with workspaceId, also syncs that workspace if its host is connected. */
    rebuildMirror(repoId: string, workspaceId?: string): Promise<void>
  }
  terminal: {
    open(workspaceId: string, path?: string): Promise<{ tabId: string; label: string }>
    write(tabId: string, d: string): void
    resize(tabId: string, c: number, r: number): void
    close(tabId: string): void
    /** Uploads the clipboard image to the tab's sandbox; resolves its remote path, or null when the clipboard has no image. */
    pasteImage(tabId: string): Promise<string | null>
    /** Uploads image bytes (png/jpg/jpeg/gif/webp, max 10MB) to the tab's sandbox; resolves the remote path. */
    uploadImage(tabId: string, bytes: Uint8Array, ext: string): Promise<string>
  }
  approval: { respond(requestId: string, decision: ApprovalDecision): void }
  prefs: {
    get(): Promise<Prefs>
    update(patch: Partial<Prefs>): Promise<Prefs>
  }
  pushLog: { read(limit: number): Promise<PushLogEntry[]> }
  on(event: 'host-status', cb: (hostId: string, s: HostStatus) => void): () => void
  on(event: 'terminal-data', cb: (tabId: string, d: string) => void): () => void
  on(event: 'terminal-exit', cb: (tabId: string, code: number) => void): () => void
  on(event: 'approval-request', cb: (req: ApprovalRequest) => void): () => void
  on(event: 'workspace-synced', cb: (id: string, info: SyncInfo) => void): () => void
}

/** Main-side implementation of the API; events are pushed with webContents.send instead of `on`. */
export type MainApi = Omit<RemodeckApi, 'on'>

export type RemodeckEvent =
  'host-status' | 'terminal-data' | 'terminal-exit' | 'approval-request' | 'workspace-synced'

export const IPC_CHANNELS = {
  hosts: {
    list: 'hosts:list',
    add: 'hosts:add',
    update: 'hosts:update',
    remove: 'hosts:remove',
    status: 'hosts:status',
    connect: 'hosts:connect',
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
  approval: { respond: 'approval:respond' },
  prefs: { get: 'prefs:get', update: 'prefs:update' },
  pushLog: { read: 'pushLog:read' },
  events: {
    'host-status': 'event:host-status',
    'terminal-data': 'event:terminal-data',
    'terminal-exit': 'event:terminal-exit',
    'approval-request': 'event:approval-request',
    'workspace-synced': 'event:workspace-synced'
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
  IPC_CHANNELS.approval.respond
])
