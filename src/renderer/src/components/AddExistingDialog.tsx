import { useEffect, useState } from 'react'
import type { Workspace } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'

export function AddExistingDialog({
  hostIds,
  onClose,
  onAdded
}: {
  hostIds: string[]
  onClose(): void
  onAdded(w: Workspace): void
}): React.JSX.Element {
  const { hosts } = useAppState()
  const [hostId, setHostId] = useState(hostIds[0] ?? '')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (busy) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      onAdded(await api.workspaces.addExisting(hostId, path.trim()))
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-label="Add existing repo">
        <h2>Add existing repo</h2>
        {hostIds.length > 1 && (
          <>
            <label htmlFor="existing-host">Host</label>
            <select
              id="existing-host"
              value={hostId}
              onChange={(e) => setHostId(e.target.value)}
              disabled={busy}
            >
              {hostIds.map((id) => (
                <option key={id} value={id}>
                  {hosts.find((h) => h.id === id)?.label ?? id}
                </option>
              ))}
            </select>
          </>
        )}
        <label htmlFor="existing-path">Path</label>
        <input
          id="existing-path"
          value={path}
          placeholder="~/work/my-app"
          onChange={(e) => setPath(e.target.value)}
          disabled={busy}
          autoFocus
        />
        {error && <div className="error">{error}</div>}
        <div className="dialog-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="primary" onClick={() => void submit()} disabled={busy || !path.trim()}>
            {busy ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}
