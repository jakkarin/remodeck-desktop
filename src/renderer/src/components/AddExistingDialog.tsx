import { useEffect, useState } from 'react'
import type { ExistingRepoInfo, Workspace } from '../../../shared/types'
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
        <input
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
              {`จะผูก workspace นี้กับ github.com/${info.owner}/${info.name}`}
            </p>
            <p>
              regit จะ fetch repo นี้ด้วย GitHub credential ของคุณ แล้ว push branch/tag ทั้งหมดของ
              repo นี้เข้า sandbox
            </p>
            {!info.known && (
              <div className="warning">
                repo นี้ยังไม่เคยใช้ใน regit — ตรวจสอบให้แน่ใจว่าเป็น repo ที่ตั้งใจ
              </div>
            )}
            {info.alwaysAllowPush && (
              <div className="warning">
                repo นี้ตั้ง Always allow push ไว้ — agent ใน sandbox จะ push ได้โดยไม่ต้องขออนุมัติ
              </div>
            )}
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <div className="dialog-actions">
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {info ? (
            <>
              <button onClick={back} disabled={busy}>
                Back
              </button>
              <button className="primary" onClick={() => void confirm()} disabled={busy}>
                {busy ? 'Adding...' : 'Confirm & Add'}
              </button>
            </>
          ) : (
            <button
              className="primary"
              onClick={() => void check()}
              disabled={busy || !path.trim()}
            >
              {busy ? 'Checking...' : 'Check'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
