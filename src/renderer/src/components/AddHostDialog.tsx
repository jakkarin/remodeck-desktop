import { useState } from 'react'
import { api, errorMessage } from '../api'
import { INVALID_SSH_HOST, isValidSshHost } from '../../../shared/validate'
import { useAppState } from '../state'

export function AddHostDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const { refresh } = useAppState()
  const [alias, setAlias] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    const a = alias.trim()
    if (!isValidSshHost(a)) {
      setError(INVALID_SSH_HOST)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.hosts.add(a, label.trim() || a)
      await refresh()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-label="Add host">
        <h2>Add host</h2>
        <label>
          SSH host alias
          <input value={alias} onChange={(e) => setAlias(e.target.value)} autoFocus />
        </label>
        <label>
          Label
          <input value={label} placeholder={alias} onChange={(e) => setLabel(e.target.value)} />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="dialog-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={() => void submit()}
            disabled={busy || !alias.trim()}
          >
            {busy ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}
