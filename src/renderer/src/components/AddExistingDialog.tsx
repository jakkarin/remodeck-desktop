import { useState } from 'react'
import type { ExistingRepoInfo, Workspace } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Field, FieldGroup, FieldLabel } from './ui/field'
import { Input } from './ui/input'
import { NativeSelect, NativeSelectOption } from './ui/native-select'

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
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add existing repo</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          {hostIds.length > 1 && (
            <Field>
              <FieldLabel htmlFor="existing-host">Host</FieldLabel>
              <NativeSelect
                id="existing-host"
                className="w-full"
                value={hostId}
                onChange={(e) => {
                  setHostId(e.target.value)
                  setInfo(null)
                }}
                disabled={locked}
              >
                {hostIds.map((id) => (
                  <NativeSelectOption key={id} value={id}>
                    {hosts.find((h) => h.id === id)?.label ?? id}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor="existing-path">Path</FieldLabel>
            <Input
              id="existing-path"
              className="font-mono"
              value={path}
              placeholder="~/work/my-app"
              onChange={(e) => {
                setPath(e.target.value)
                setInfo(null)
              }}
              disabled={locked}
              autoFocus
            />
          </Field>
          {info && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-semibold break-words">
                {`This workspace will be linked to github.com/${info.owner}/${info.name}`}
              </p>
              <p className="text-muted-foreground break-words">
                remodeck will fetch this repo with your GitHub credentials, then push all of its
                branches/tags into the sandbox
              </p>
              {!info.known && (
                <Alert className="bg-warning-soft text-warning">
                  <AlertDescription className="text-warning">
                    This repo has not been used in remodeck before — make sure it is the one you
                    intend
                  </AlertDescription>
                </Alert>
              )}
              {info.alwaysAllowPush && (
                <Alert className="bg-warning-soft text-warning">
                  <AlertDescription className="text-warning">
                    This repo has Always allow push on — agents in the sandbox can push without
                    approval
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {info ? (
            <>
              <Button variant="outline" onClick={back} disabled={busy}>
                Back
              </Button>
              <Button onClick={() => void confirm()} disabled={busy}>
                {busy ? 'Adding...' : 'Confirm & Add'}
              </Button>
            </>
          ) : (
            <Button onClick={() => void check()} disabled={busy || !path.trim()}>
              {busy ? 'Checking...' : 'Check'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
