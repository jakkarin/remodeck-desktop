import { GitBranch, SquareTerminal } from 'lucide-react'
import type { BranchInfo, WorktreeInfo } from '../../../shared/types'
import { ErrorBanner } from './ErrorBanner'

const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

export function BranchPane({
  branches,
  worktrees,
  selected,
  isNew,
  connected,
  error,
  onSelect,
  onOpenTerminal,
  onRebuild
}: {
  branches: BranchInfo[]
  worktrees: WorktreeInfo[]
  selected: string | null
  isNew(b: BranchInfo): boolean
  connected: boolean
  error: string | null
  onSelect(name: string): void
  onOpenTerminal(path: string): void
  onRebuild(): void
}): React.JSX.Element {
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    if (branches.length === 0) return
    const i = branches.findIndex((b) => b.name === selected)
    const next = e.key === 'ArrowDown' ? Math.min(i + 1, branches.length - 1) : Math.max(i - 1, 0)
    onSelect(branches[next].name)
  }

  return (
    <div className="pane">
      <div className="pane-header">Branches</div>
      {error && <ErrorBanner message={error} onRebuild={onRebuild} />}
      <div
        className="branch-list"
        role="listbox"
        aria-label="Branches"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {branches.map((b) => (
          <div
            key={b.name}
            role="option"
            aria-selected={b.name === selected}
            className={`branch-row${b.name === selected ? ' selected' : ''}`}
            onClick={() => onSelect(b.name)}
          >
            <GitBranch size={13} />
            <span className="branch-name">{b.name}</span>
            {b.ahead > 0 && <span className="muted">{`↑${b.ahead}`}</span>}
            {b.behind > 0 && <span className="muted">{`↓${b.behind}`}</span>}
            {isNew(b) && (
              <span className="new-dot" aria-label="ใหม่">
                ●
              </span>
            )}
            {b.merged && <span className="badge">merged</span>}
            {b.rewritten && <span className="badge warn">⚠ rewritten</span>}
          </div>
        ))}
      </div>
      {connected && worktrees.length > 0 && (
        <div className="worktrees-section">
          <div className="pane-subheader">Worktrees</div>
          {worktrees.map((w) => (
            <div key={w.path} className="worktree-row" title={w.path}>
              <span className="branch-name">{baseName(w.path)}</span>
              <span className="muted">{w.branch ?? 'detached'}</span>
              {w.dirty > 0 && <span className="badge warn">{`${w.dirty}✎`}</span>}
              <button
                className="icon-btn"
                aria-label={`Open terminal in ${baseName(w.path)}`}
                onClick={() => onOpenTerminal(w.path)}
              >
                <SquareTerminal size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
