import { useState } from 'react'
import { FileCode } from 'lucide-react'
import { Button } from './ui/button'
import { PaneTitle } from './Pane'

const MAX_LINES = 5000

function diffClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'diff-add'
  if (line.startsWith('-') && !line.startsWith('---')) return 'diff-del'
  if (line.startsWith('@@')) return 'diff-hunk'
  return ''
}

export function DiffPane({
  text,
  path,
  oldPath,
  binary = false
}: {
  text: string
  path: string
  oldPath?: string
  binary?: boolean
}): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const all = text.replace(/\n$/, '').split('\n')
  const truncated = !showAll && all.length > MAX_LINES
  const lines = truncated ? all.slice(0, MAX_LINES) : all
  const label = oldPath ? `${oldPath} → ${path}` : path

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneTitle icon={<FileCode size={14} />} title={label} className="font-mono text-xs">
        {label}
      </PaneTitle>
      {binary ? (
        <div className="p-3.5 text-muted-foreground">Binary file</div>
      ) : (
        <pre className="diff">
          <div className="diff-lines">
            {lines.map((line, i) => (
              <div key={i} className={diffClass(line)}>
                {line}
              </div>
            ))}
          </div>
          {truncated && (
            <Button variant="secondary" className="m-3" onClick={() => setShowAll(true)}>
              Show all
            </Button>
          )}
        </pre>
      )}
    </div>
  )
}
