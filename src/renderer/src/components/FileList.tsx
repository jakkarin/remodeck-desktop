import { AnimatePresence, motion } from 'motion/react'
import type { FileChange } from '../../../shared/types'
import { useTransitionFor } from '../motion'
import { SectionLabel } from './Pane'

/** Above this many rows, enter/exit animation is skipped. */
export const ANIMATE_ROW_LIMIT = 100

const STATUS_COLOR: Record<FileChange['status'], string> = {
  A: 'text-success',
  M: 'text-warning',
  D: 'text-destructive',
  R: 'text-warning'
}

function splitPath(path: string): [string, string] {
  const i = path.lastIndexOf('/')
  return i < 0 ? ['', path] : [path.slice(0, i + 1), path.slice(i + 1)]
}

const ROW = 'relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent'

export function FileList({
  files,
  selected,
  onSelect
}: {
  files: FileChange[]
  selected: string | null
  onSelect(path: string): void
}): React.JSX.Element {
  const layout = useTransitionFor('layout')
  const enter = useTransitionFor('enter')
  const exit = useTransitionFor('exit')
  const animated = files.length <= ANIMATE_ROW_LIMIT

  const content = (f: FileChange): React.JSX.Element => {
    const [dir, name] = splitPath(f.path)
    return (
      <>
        {f.path === selected && (
          <motion.div
            layoutId="file-selection"
            transition={layout}
            aria-hidden="true"
            className="absolute inset-0 rounded-md bg-selected"
          />
        )}
        <span
          className={`relative w-4 font-mono text-[11px] font-semibold ${STATUS_COLOR[f.status]}`}
        >
          {f.status}
        </span>
        <span
          className={`relative min-w-0 flex-1 truncate ${f.status === 'D' ? 'text-muted-foreground line-through' : ''}`}
          title={f.path}
        >
          {dir && <span className="text-muted-foreground">{dir}</span>}
          {name}
        </span>
        {f.additions !== null && f.deletions !== null && (
          <span className="relative font-mono text-[11px]">
            <span className="text-success">{`+${f.additions}`}</span>{' '}
            <span className="text-destructive">{`−${f.deletions}`}</span>
          </span>
        )}
      </>
    )
  }

  return (
    <>
      <SectionLabel>Files ({files.length})</SectionLabel>
      <ul
        className="m-0 flex list-none flex-col gap-px px-1.5 py-0"
        data-animated={animated ? 'true' : undefined}
      >
        {animated ? (
          <AnimatePresence initial={false}>
            {files.map((f) => (
              <motion.li
                key={f.path}
                className={`${ROW} overflow-hidden`}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1, transition: enter }}
                exit={{ height: 0, opacity: 0, transition: exit }}
                onClick={() => onSelect(f.path)}
              >
                {content(f)}
              </motion.li>
            ))}
          </AnimatePresence>
        ) : (
          files.map((f) => (
            <li key={f.path} className={ROW} onClick={() => onSelect(f.path)}>
              {content(f)}
            </li>
          ))
        )}
      </ul>
    </>
  )
}
