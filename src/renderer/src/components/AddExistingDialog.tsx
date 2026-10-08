import { useEffect, useState } from 'react'
import type { ExistingRepoInfo, Workspace } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { Button, TextInput } from './ui'

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
  // Set after a successful Check: the repo the sandbox's origin resolves to, awaiting the user's confirmation.
  const [info, setInfo] = useState<ExistingRepoInfo | null>(null)
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

  const check = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setInfo(await api.workspaces.inspectExisting(hostId, path.trim()))
    } catch (e) {
      setError(errorMessage(e))
    }
    setBusy(false)
  }

  const confirm = async (): Promise<void> => {
    if (!info) return
    setBusy(true)
    setError(null)
    try {
      onAdded(
        await api.workspaces.addExisting(hostId, path.trim(), {
          owner: info.owner,
          name: info.name
        })
      )
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const back = (): void => {
    setInfo(null)
    setError(null)
  }

  const locked = busy || info !== null

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
              onChange={(e) => {
                setHostId(e.target.value)
                setInfo(null)
              }}
              disabled={locked}
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
        <TextInput
          id="existing-path"
          value={path}
          placeholder="~/work/my-app"
          onChange={(e) => {
            setPath(e.target.value)
            setInfo(null)
          }}
          disabled={locked}
          autoFocus
        />
        {info && (
          <div className="confirm-existing">
            <p className="confirm-target">
              {`This workspace will be linked to github.com/${info.owner}/${info.name}`}
            </p>
            <p>
              remodeck will fetch this repo with your GitHub credentials, then push all of its branches/tags
              into the sandbox
            </p>
            {!info.known && (
              <div className="warning">
                This repo has not been used in remodeck before — make sure it is the one you intend
              </div>
            )}
            {info.alwaysAllowPush && (
              <div className="warning">
                This repo has Always allow push on — agents in the sandbox can push without approval
              </div>
            )}
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <div className="dialog-actions">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {info ? (
            <>
              <Button onClick={back} disabled={busy}>
                Back
              </Button>
              <Button variant="primary" onClick={() => void confirm()} disabled={busy}>
                {busy ? 'Adding...' : 'Confirm & Add'}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => void check()} disabled={busy || !path.trim()}>
              {busy ? 'Checking...' : 'Check'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
