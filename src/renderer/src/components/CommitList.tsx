import type { CommitInfo } from '../../../shared/types'

export function CommitList({
  commits,
  selected,
  onSelect
}: {
  commits: CommitInfo[]
  selected: string | null
  onSelect(sha: string | null): void
}): React.JSX.Element {
  return (
    <>
      <div className="pane-subheader">Commits ({commits.length})</div>
      <ul className="commits">
        {commits.map((c) => (
          <li
            key={c.sha}
            className={c.sha === selected ? 'selected' : undefined}
            onClick={() => onSelect(c.sha === selected ? null : c.sha)}
          >
            <code>{c.sha.slice(0, 7)}</code>
            <span className="commit-subject" title={c.subject}>
              {c.subject}
            </span>
            <span className="muted commit-meta" title={`${c.author} · ${c.date}`}>
              {c.author} · {c.date}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}
