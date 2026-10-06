// Shared between main and renderer: types only, no node imports.

export type Host = { id: string; sshHost: string; label: string; protected: boolean }

export type Repo = {
  id: string
  owner: string
  name: string
  defaultBranch: string
  protectedBranches: string[]
  alwaysAllowPush: boolean
  enforceRules: boolean
}

/** What an existing sandbox repo resolves to, shown to the user before anything is fetched. */
export type ExistingRepoInfo = {
  owner: string
  name: string
  known: boolean
  alwaysAllowPush: boolean
}
export type Workspace = { id: string; repoId: string; hostId: string; sandboxPath: string }

export type Theme = 'system' | 'light' | 'dark'

export type Prefs = {
  theme: Theme
  terminalFontSize: number
  defaultProtectedBranches: string[]
}

export const THEMES: readonly Theme[] = ['system', 'light', 'dark']
export const TERMINAL_FONT_MIN = 10
export const TERMINAL_FONT_MAX = 20
export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  terminalFontSize: 13,
  defaultProtectedBranches: ['main', 'master']
}

export type Config = { hosts: Host[]; repos: Repo[]; workspaces: Workspace[]; prefs: Prefs }

export type RefUpdate = { oldSha: string; newSha: string; ref: string }

export type PushLogEntry = {
  time: string
  repo: string
  workspaceId: string | null
  channel: 'review' | 'bridge'
  updates: RefUpdate[]
  result: 'ok' | 'denied' | 'blocked' | 'rejected' | 'error'
  detail?: string
}

export type BranchInfo = {
  name: string
  sha: string
  base: string
  ahead: number
  behind: number
  merged: boolean
  rewritten: boolean
}

export type FileChange = {
  path: string
  oldPath?: string
  status: 'A' | 'M' | 'D' | 'R'
  additions: number | null
  deletions: number | null
}

export type CommitInfo = { sha: string; subject: string; author: string; date: string }

export type WorktreeInfo = {
  path: string
  branch: string | null
  head: string | null
  dirty: number
}

export type SyncInfo = { kind: 'light' | 'full'; at: number; error?: string }

export type HostState = 'disconnected' | 'connecting' | 'connected' | 'error'

export type GitCapability = { version: string; remoteHttp: boolean; forward: boolean }

export type HostStatus = {
  state: HostState
  error?: string
}

export type PushOutcome =
  { ok: true } | { ok: false; reason: 'protected' | 'non-fast-forward' | 'error'; message: string }

export type ApprovalDecision = 'once' | 'session' | 'always' | 'deny'

export type ApprovalRequest = {
  id: string
  repoId: string
  repoLabel: string
  sessionId: string
  tabLabel: string
  updates: RefUpdate[]
}
