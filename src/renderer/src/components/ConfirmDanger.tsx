import { useState } from 'react'
import type { Host } from '../../../shared/types'
import { errorMessage } from '../api'
import { Button, TextInput } from './ui'

export function ConfirmDanger({
  host,
  summary,
  confirmLabel,
  mode,
  onConfirm,
  onClose
}: {
  host: Host
  summary: string
  confirmLabel: string
  mode: 'click' | 'type'
  onConfirm(): Promise<void>
  onClose(): void
}): React.JSX.Element {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const matches = mode === 'click' || typed === host.label
  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-labelledby="confirm-danger-host">
        <h2 id="confirm-danger-host" style={{ fontSize: '1.5em' }}>
          {host.label}
        </h2>
        <p>{summary}</p>
        {mode === 'type' && (
          <TextInput
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Type the host name to confirm"
            placeholder={host.label}
            autoFocus
          />
        )}
        {error && <div className="error">{error}</div>}
        <div className="dialog-actions">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={busy || !matches}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
