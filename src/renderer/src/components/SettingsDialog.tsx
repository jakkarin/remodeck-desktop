import { X } from 'lucide-react'
import { SettingsView } from './SettingsView'

export function SettingsDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  return (
    <div className="dialog-backdrop">
      <div className="dialog settings-dialog" role="dialog" aria-label="Settings">
        <button className="icon-btn dialog-close" aria-label="Close" onClick={onClose}>
          <X size={16} />
        </button>
        <SettingsView />
      </div>
    </div>
  )
}
