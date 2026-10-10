import { useState } from 'react'
import { api, errorMessage } from '../api'
import { INVALID_SSH_HOST, isValidSshHost } from '../../../shared/validate'
import { useAppState } from '../state'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { Field, FieldGroup, FieldLabel } from './ui/field'
import { Input } from './ui/input'

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
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add host</DialogTitle>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="addhost-alias">SSH host alias</FieldLabel>
            <Input
              id="addhost-alias"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="addhost-label">Label</FieldLabel>
            <Input
              id="addhost-label"
              value={label}
              placeholder={alias}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
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
          <Button onClick={() => void submit()} disabled={busy || !alias.trim()}>
            {busy ? 'Adding...' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
