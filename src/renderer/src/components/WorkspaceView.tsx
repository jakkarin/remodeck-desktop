import { useCallback, useEffect, useState } from 'react'
import type { BranchInfo, WorktreeInfo } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { ReviewView } from './ReviewView'

/** Opens a terminal tab for the workspace (Task 18 renders the tabs from events). */
// eslint-disable-next-line react-refresh/only-export-components -- hook point for Task 18
export function openTerminal(workspaceId: string, path?: string): Promise<unknown> {
  return api.terminal.open(workspaceId, path)
}

export function WorkspaceView({ workspaceId }: { workspaceId: string }): React.JSX.Element {
  const { hosts, repos, workspaces, statuses } = useAppState()
  const ws = workspaces.find((w) => w.id === workspaceId)
  const repo = repos.find((r) => r.id === ws?.repoId)
  const host = hosts.find((h) => h.id === ws?.hostId)
  const connected = !!host && statuses[host.id]?.state === 'connected'

  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([])
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewBranch, setReviewBranch] = useState<BranchInfo | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setBranches(await api.workspaces.branches(workspaceId))
      setWorktrees(connected ? await api.workspaces.worktrees(workspaceId) : [])
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [workspaceId, connected])

  useEffect(() => {
    // load is async: state is set after awaiting IPC, not synchronously in the effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function sync(): Promise<void> {
    setSyncing(true)
    setError(null)
    try {
      await api.workspaces.sync(workspaceId)
      await load()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSyncing(false)
    }
  }

  async function rebuild(): Promise<void> {
    if (!repo) return
    try {
      await api.workspaces.rebuildMirror(repo.id)
      await load()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function open(path?: string): Promise<void> {
    try {
      await openTerminal(workspaceId, path)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  if (reviewBranch) {
    return (
      <ReviewView
        workspaceId={workspaceId}
        branch={reviewBranch}
        onBack={() => setReviewBranch(null)}
      />
    )
  }

  const isGitError = !!error && (error.includes('git ') || error.includes('fatal:'))

  return (
    <div className="workspace">
      <div className="toolbar">
        <h2>
          {repo ? `${repo.owner}/${repo.name}` : '?'} @ {host?.label}:{ws?.sandboxPath}
        </h2>
        <button disabled={!connected || syncing} onClick={() => void sync()}>
          Sync
        </button>
        <button onClick={() => void load()}>Refresh</button>
        <button disabled={!connected} onClick={() => void open()}>
          Open terminal
        </button>
        {isGitError && <button onClick={() => void rebuild()}>Rebuild mirror</button>}
      </div>
      {syncing && <div className="muted">Syncing...</div>}
      {error && <div className="error">{error}</div>}

      <table className="branches">
        <thead>
          <tr>
            <th>Branch</th>
            <th>Ahead</th>
            <th>Behind</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {branches.map((b) => (
            <tr key={b.name} onClick={() => setReviewBranch(b)}>
              <td>{b.name}</td>
              <td>{b.ahead}</td>
              <td>{b.behind}</td>
              <td>
                {b.merged && <span className="badge">merged</span>}
                {b.rewritten && <span className="badge warn">history rewritten</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {connected && worktrees.length > 0 && (
        <>
          <h3>Worktrees</h3>
          <ul className="worktrees">
            {worktrees.map((w) => (
              <li key={w.path}>
                <span>{w.path}</span>
                <span className="muted">{w.branch ?? 'detached'}</span>
                {w.dirty > 0 && <span className="badge warn">{w.dirty} dirty</span>}
                <button onClick={() => void open(w.path)}>Open terminal</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
