import type { FileChange } from '../../../shared/types'

export function FileList({
  files,
  selected,
  onSelect
}: {
  files: FileChange[]
  selected: string | null
  onSelect(path: string): void
}): React.JSX.Element {
  return (
    <>
      <div className="pane-subheader">Files ({files.length})</div>
      <ul className="files">
        {files.map((f) => (
          <li
            key={f.path}
            className={f.path === selected ? 'selected' : undefined}
            onClick={() => onSelect(f.path)}
          >
            <span className={`file-status file-${f.status}`}>{f.status}</span>
            <span className="file-path">{f.path}</span>
            {f.additions !== null && f.deletions !== null && (
              <span className="muted">{`+${f.additions} −${f.deletions}`}</span>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
