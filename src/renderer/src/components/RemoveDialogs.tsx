import { useState } from 'react'
import type { Host, Workspace } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { Alert, AlertDescription } from './ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from './ui/alert-dialog'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Label } from './ui/label'

function ConfirmDialog({
  title,
  description,
  children,
  onConfirm,
  onClose
}: {
  title: string
  description: React.ReactNode
  children?: React.ReactNode
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
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {/* Not AlertDialogAction: that closes on click, but we stay open until onConfirm settles. */}
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            Remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Removes a workspace from remodeck only; nothing in the sandbox is deleted. */
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
      description={
        <>
          Remove workspace <b>{label}</b> from remodeck — no files in the sandbox are deleted
        </>
      }
      onClose={onClose}
      onConfirm={async () => {
        await api.workspaces.remove(workspace.id, last && deleteMirror)
        await refresh()
      }}
    >
      {last && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="remove-mirror"
            checked={deleteMirror}
            onCheckedChange={(checked) => setDeleteMirror(checked === true)}
          />
          <Label htmlFor="remove-mirror">Also delete the mirror?</Label>
        </div>
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
      description={
        <>
          Remove host <b>{host.label}</b> from remodeck — no files in the sandbox are deleted
        </>
      }
      onClose={onClose}
      onConfirm={async () => {
        await api.hosts.remove(host.id)
        await refresh()
      }}
    />
  )
}
