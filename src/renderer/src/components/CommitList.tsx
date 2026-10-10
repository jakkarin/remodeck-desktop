import { motion } from 'motion/react'
import type { CommitInfo } from '../../../shared/types'
import { useTransitionFor } from '../motion'
import { SectionLabel } from './Pane'

export function CommitList({
  commits,
  selected,
  onSelect
}: {
  commits: CommitInfo[]
  selected: string | null
  onSelect(sha: string | null): void
}): React.JSX.Element {
  const layout = useTransitionFor('layout')
  return (
    <>
      <SectionLabel>Commits ({commits.length})</SectionLabel>
      <ul className="m-0 flex list-none flex-col gap-px px-1.5 py-0">
        {commits.map((c) => (
          <li
            key={c.sha}
            className="relative flex cursor-pointer flex-col gap-px rounded-md px-2 py-1.5 hover:bg-accent"
            onClick={() => onSelect(c.sha === selected ? null : c.sha)}
          >
            {c.sha === selected && (
              <motion.div
                layoutId="commit-selection"
                transition={layout}
                aria-hidden="true"
                className="absolute inset-0 rounded-md bg-selected"
              />
            )}
            <span className="relative truncate" title={c.subject}>
              {c.subject}
            </span>
            <span className="relative flex min-w-0 gap-1 text-xs text-muted-foreground">
              <code className="shrink-0 font-mono">{c.sha.slice(0, 7)}</code>
              <span className="truncate" title={`${c.author} · ${c.date}`}>
                {c.author} · {c.date}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}
