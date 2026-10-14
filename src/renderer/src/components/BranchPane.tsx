import { GitBranch, SquareTerminal } from 'lucide-react'
import { motion } from 'motion/react'
import type { BranchInfo, WorktreeInfo } from '../../../shared/types'
import { useTransitionFor } from '../motion'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Banner } from './Banner'
import { PaneTitle, SectionLabel } from './Pane'
import { rebuildAction } from './rebuildAction'

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
  const layout = useTransitionFor('layout')
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    if (branches.length === 0) return
    const i = branches.findIndex((b) => b.name === selected)
    const next = e.key === 'ArrowDown' ? Math.min(i + 1, branches.length - 1) : Math.max(i - 1, 0)
    onSelect(branches[next].name)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneTitle icon={<GitBranch size={14} />}>Branches</PaneTitle>
      {error && (
        <Banner tone="danger" action={rebuildAction(error, onRebuild)}>
          {error}
        </Banner>
      )}
      <div
        className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
        role="listbox"
        aria-label="Branches"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {branches.map((b) => {
          const isSelected = b.name === selected
          return (
            <div
              key={b.name}
              role="option"
              aria-selected={isSelected}
              className="relative flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
              onClick={() => onSelect(b.name)}
            >
              {isSelected && (
                <motion.div
                  layoutId="branch-selection"
                  transition={layout}
                  aria-hidden="true"
                  className="absolute inset-0 rounded-md bg-selected"
                />
              )}
              <GitBranch size={13} className="relative shrink-0 text-muted-foreground" />
              <span
                className={`relative min-w-0 flex-1 truncate ${isSelected ? 'font-medium' : ''}`}
              >
                {b.name}
              </span>
              {b.ahead > 0 && (
                <span className="relative font-mono text-[11px] text-muted-foreground">{`↑${b.ahead}`}</span>
              )}
              {b.behind > 0 && (
                <span className="relative font-mono text-[11px] text-muted-foreground">{`↓${b.behind}`}</span>
              )}
              {isNew(b) && (
                <span className="relative text-(--accent)" aria-label="New">
                  ●
                </span>
              )}
              {b.merged && (
                <Badge variant="secondary" className="relative">
                  merged
                </Badge>
              )}
              {b.rewritten && (
                <Badge variant="warning" className="relative">
                  ⚠ rewritten
                </Badge>
              )}
            </div>
          )
        })}
      </div>
      {connected && worktrees.length > 0 && (
        <div className="border-t border-border pb-2">
          <SectionLabel>Worktrees</SectionLabel>
          <div className="flex flex-col px-1.5">
            {worktrees.map((w) => (
              <div
                key={w.path}
                className="flex min-h-8 items-center gap-2 rounded-md px-2 py-1"
                title={w.path}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {baseName(w.path)}
                </span>
                <span className="text-xs text-muted-foreground">{w.branch ?? 'detached'}</span>
                {w.dirty > 0 && <Badge variant="warning">{`${w.dirty}✎`}</Badge>}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Open terminal in ${baseName(w.path)}`}
                  onClick={() => onOpenTerminal(w.path)}
                >
                  <SquareTerminal />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
