// Typed IPC contract between main and renderer: types and channel names only, no node imports.
import type {
  ApprovalDecision,
  ApprovalRequest,
  BranchInfo,
  CommitInfo,
  Host,
  HostStatus,
  PushLogEntry,
  PushOutcome,
  Repo,
  Workspace,
  WorktreeInfo
} from './types'

export type RepoPolicyPatch = Partial<
  Pick<Repo, 'protectedBranches' | 'alwaysAllowPush' | 'enforceRules'>
>

/** Exposed to the renderer as `window.regit`. */
export interface RegitApi {
  hosts: {
    list(): Promise<Host[]>
    add(sshHost: string, label: string): Promise<Host>
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
    remove(id: string, deleteMirrorIfLast: boolean): Promise<void>
    sync(id: string): Promise<{ rewritten: string[] }>
    branches(id: string): Promise<BranchInfo[]>
    commits(id: string, branch: string): Promise<CommitInfo[]>
    diff(id: string, branch: string): Promise<string>
    worktrees(id: string): Promise<WorktreeInfo[]>
    push(id: string, branch: string, target: string): Promise<PushOutcome>
    openPR(id: string, target: string): Promise<void>
    rebuildMirror(repoId: string): Promise<void>
  }
  terminal: {
    open(workspaceId: string, path?: string): Promise<{ tabId: string; label: string }>
    write(tabId: string, d: string): void
    resize(tabId: string, c: number, r: number): void
    close(tabId: string): void
  }
  approval: { respond(requestId: string, decision: ApprovalDecision): void }
  pushLog: { read(limit: number): Promise<PushLogEntry[]> }
  on(event: 'host-status', cb: (hostId: string, s: HostStatus) => void): () => void
  on(event: 'terminal-data', cb: (tabId: string, d: string) => void): () => void
  on(event: 'terminal-exit', cb: (tabId: string, code: number) => void): () => void
  on(event: 'approval-request', cb: (req: ApprovalRequest) => void): () => void
}

/** Main-side implementation of the API; events are pushed with webContents.send instead of `on`. */
export type MainApi = Omit<RegitApi, 'on'>

export type RegitEvent = 'host-status' | 'terminal-data' | 'terminal-exit' | 'approval-request'

export const IPC_CHANNELS = {
  hosts: {
    list: 'hosts:list',
    add: 'hosts:add',
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
    remove: 'workspaces:remove',
    sync: 'workspaces:sync',
    branches: 'workspaces:branches',
    commits: 'workspaces:commits',
    diff: 'workspaces:diff',
    worktrees: 'workspaces:worktrees',
    push: 'workspaces:push',
    openPR: 'workspaces:openPR',
    rebuildMirror: 'workspaces:rebuildMirror'
  },
  terminal: {
    open: 'terminal:open',
    write: 'terminal:write',
    resize: 'terminal:resize',
    close: 'terminal:close'
  },
  approval: { respond: 'approval:respond' },
  pushLog: { read: 'pushLog:read' },
  events: {
    'host-status': 'event:host-status',
    'terminal-data': 'event:terminal-data',
    'terminal-exit': 'event:terminal-exit',
    'approval-request': 'event:approval-request'
  }
} as const satisfies { [G in keyof MainApi]: { [M in keyof MainApi[G]]: string } } & {
  events: Record<RegitEvent, string>
}

/** Fire-and-forget channels (ipcRenderer.send / ipcMain.on); every other method channel is invoke/handle. */
export const SEND_CHANNELS: ReadonlySet<string> = new Set<string>([
  IPC_CHANNELS.terminal.write,
  IPC_CHANNELS.terminal.resize,
  IPC_CHANNELS.terminal.close,
  IPC_CHANNELS.approval.respond
])
