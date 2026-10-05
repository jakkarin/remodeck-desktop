import { X } from 'lucide-react'
import { IconButton } from './ui'
import { SettingsView } from './SettingsView'

export function SettingsDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  return (
    <div className="dialog-backdrop">
      <div className="dialog settings-dialog" role="dialog" aria-label="Settings">
        <IconButton className="dialog-close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </IconButton>
        <SettingsView />
      </div>
    </div>
  )
}
