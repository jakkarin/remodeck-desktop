import { useState } from 'react'
import type { Host, Workspace } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { Button } from './ui'

function ConfirmDialog({
  title,
  children,
  onConfirm,
  onClose
}: {
  title: string
  children: React.ReactNode
  onConfirm(): Promise<void>
  onClose(): void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      <div className="dialog" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
        {error && <div className="error">{error}</div>}
        <div className="dialog-actions">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={busy}>
            Remove
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Removes a workspace from regit only; nothing in the sandbox is deleted. */
export function RemoveWorkspaceDialog({
  workspace,
  label,
  onClose
}: {
  workspace: Workspace
  label: string
  onClose(): void
}): React.JSX.Element {
  const { workspaces, refresh } = useAppState()
  const last = workspaces.filter((w) => w.repoId === workspace.repoId).length === 1
  const [deleteMirror, setDeleteMirror] = useState(false)
  return (
    <ConfirmDialog
      title="Remove workspace"
      onClose={onClose}
      onConfirm={async () => {
        await api.workspaces.remove(workspace.id, last && deleteMirror)
        await refresh()
      }}
    >
      <p>
        ลบ workspace <b>{label}</b> ออกจาก regit — ไม่มีการลบไฟล์ใน sandbox
      </p>
      {last && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={deleteMirror}
            onChange={(e) => setDeleteMirror(e.target.checked)}
          />
          ลบ mirror ด้วยไหม?
        </label>
      )}
    </ConfirmDialog>
  )
}

export function RemoveHostDialog({
  host,
  onClose
}: {
  host: Host
  onClose(): void
}): React.JSX.Element {
  const { refresh } = useAppState()
  return (
    <ConfirmDialog
      title="Remove host"
      onClose={onClose}
      onConfirm={async () => {
        await api.hosts.remove(host.id)
        await refresh()
      }}
    >
      <p>
        ลบ host <b>{host.label}</b> ออกจาก regit — ไม่มีการลบไฟล์ใน sandbox
      </p>
    </ConfirmDialog>
  )
}
