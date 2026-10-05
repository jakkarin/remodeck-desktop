import { useState, type ReactNode } from 'react'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { openTerminal } from '../terminalEvents'
import { useWorkspaceData } from '../useWorkspaceData'
import { BranchPane } from './BranchPane'
import { ChangesPane } from './ChangesPane'
import { DiffPane } from './DiffPane'
import { ErrorBanner } from './ErrorBanner'
import { SplitLayout } from './SplitLayout'

/**
 * Branches / Changes / Diff columns for one workspace over the docked `bottom` slot. State is reset when
 * `workspaceId` changes (see useWorkspaceData) instead of remounting, so the terminals in `bottom` survive.
 */
export function WorkspaceScreen({
  workspaceId,
  bottom = null,
  bottomCollapsed = false
}: {
  workspaceId: string
  bottom?: ReactNode
  bottomCollapsed?: boolean
}): React.JSX.Element {
  const { hosts, repos, workspaces, statuses, setStatus } = useAppState()
  const ws = workspaces.find((w) => w.id === workspaceId)
  const host = hosts.find((h) => h.id === ws?.hostId)
  const repo = repos.find((r) => r.id === ws?.repoId)
  const connected = !!host && statuses[host.id]?.state === 'connected'
  const [actionError, setActionError] = useState<string | null>(null)
  const d = useWorkspaceData(workspaceId, connected)

  async function rebuild(): Promise<void> {
    if (!repo) return
    try {
      await api.workspaces.rebuildMirror(repo.id, workspaceId)
      await d.reload()
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }

  async function connect(): Promise<void> {
    if (!host) return
    try {
      setStatus(host.id, await api.hosts.connect(host.id))
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }

  async function open(path?: string): Promise<void> {
    try {
      await openTerminal(workspaceId, path)
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }

  const rebuildFn = (): void => void rebuild()
  const branchesError = d.branchesError ?? actionError
  const diffError = d.diffError
  return (
    <div className="screen">
      {!connected && (
        <div className="disconnected-banner">
          <span>{host?.label ?? 'Host'} ไม่ได้เชื่อมต่อ</span>
          <button onClick={() => void connect()}>Connect</button>
        </div>
      )}
      <SplitLayout
        bottom={bottom}
        bottomCollapsed={bottomCollapsed}
        left={
          <BranchPane
            branches={d.branches}
            worktrees={d.worktrees}
            selected={d.branch?.name ?? null}
            isNew={d.isNew}
            connected={connected}
            error={branchesError}
            onSelect={d.selectBranch}
            onOpenTerminal={(p) => void open(p)}
            onRebuild={rebuildFn}
          />
        }
        middle={
          <ChangesPane
            workspaceId={workspaceId}
            branch={d.branch}
            commits={d.commits}
            files={d.files}
            commit={d.commit}
            file={d.file?.path ?? null}
            connected={connected}
            error={d.changesError}
            onSelectCommit={d.selectCommit}
            onSelectFile={d.selectFile}
            onRebuild={rebuildFn}
          />
        }
        right={
          <div className="pane">
            {diffError && <ErrorBanner message={diffError} onRebuild={rebuildFn} />}
            {d.file && d.diffText !== null ? (
              <DiffPane
                key={`${d.branch?.name}|${d.commit}|${d.file.path}`}
                text={d.diffText}
                path={d.file.path}
                oldPath={d.file.oldPath}
                binary={d.file.additions === null}
              />
            ) : (
              <>
                <div className="pane-header">Diff</div>
                <div className="muted pad">เลือกไฟล์เพื่อดู diff</div>
              </>
            )}
          </div>
        }
      />
    </div>
  )
}
