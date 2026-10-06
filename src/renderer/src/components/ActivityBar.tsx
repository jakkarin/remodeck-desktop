import { GitBranch, Settings } from 'lucide-react'
import { IconButton } from './ui'

export function ActivityBar({ onOpenSettings }: { onOpenSettings(): void }): React.JSX.Element {
  return (
    <nav className="activity-bar" aria-label="Activity bar">
      <IconButton className="activity-btn" aria-label="Git" aria-pressed="true">
        <GitBranch size={18} />
      </IconButton>
      <span className="activity-spacer" />
      <IconButton className="activity-btn" aria-label="Settings" onClick={onOpenSettings}>
        <Settings size={18} />
      </IconButton>
    </nav>
  )
}
