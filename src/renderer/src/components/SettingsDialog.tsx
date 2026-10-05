import { X } from 'lucide-react'
import type { SettingsSection } from '../settingsOpener'
import { IconButton } from './ui'
import { SettingsView } from './SettingsView'

export function SettingsDialog({
  onClose,
  initialSection,
  initialRepoId
}: {
  onClose(): void
  initialSection?: SettingsSection
  initialRepoId?: string
}): React.JSX.Element {
  return (
    <div className="dialog-backdrop">
      <div className="dialog settings-dialog" role="dialog" aria-label="Settings">
        <IconButton className="dialog-close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </IconButton>
        <SettingsView initialSection={initialSection} initialRepoId={initialRepoId} />
      </div>
    </div>
  )
}
