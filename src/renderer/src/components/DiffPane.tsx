import { useState } from 'react'
import { FileCode } from 'lucide-react'
import { Button, PaneHeader } from './ui'

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

  return (
    <div className="diff-pane">
      <PaneHeader icon={<FileCode size={14} />} title={oldPath ? `${oldPath} → ${path}` : path}>
        {oldPath ? `${oldPath} → ${path}` : path}
      </PaneHeader>
      {binary ? (
        <div className="muted pad">Binary file</div>
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
            <Button className="diff-more" onClick={() => setShowAll(true)}>
              แสดงทั้งหมด
            </Button>
          )}
        </pre>
      )}
    </div>
  )
}
