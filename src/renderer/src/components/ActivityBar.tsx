import { Container, GitBranch, Settings } from 'lucide-react'
import { useAppState } from '../state'
import { IconButton } from './ui'

export function ActivityBar({ onOpenSettings }: { onOpenSettings(): void }): React.JSX.Element {
  const { activeModule, selectModule } = useAppState()
  return (
    <nav className="activity-bar" aria-label="Activity bar">
      <IconButton
        className="activity-btn"
        aria-label="Git"
        aria-pressed={activeModule === 'git'}
        onClick={() => selectModule('git')}
      >
        <GitBranch size={18} />
      </IconButton>
      <IconButton
        className="activity-btn"
        aria-label="Containers"
        aria-pressed={activeModule === 'containers'}
        onClick={() => selectModule('containers')}
      >
        <Container size={18} />
      </IconButton>
      <span className="activity-spacer" />
      <IconButton className="activity-btn" aria-label="Settings" onClick={onOpenSettings}>
        <Settings size={18} />
      </IconButton>
    </nav>
  )
}
