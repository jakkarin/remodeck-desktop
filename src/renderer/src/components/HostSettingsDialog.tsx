import { useState } from 'react'
import type { Host } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { HostGitAccessPanel } from './HostGitAccessPanel'
import { Alert, AlertDescription } from './ui/alert'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog'
import { Field, FieldGroup, FieldLabel } from './ui/field'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Separator } from './ui/separator'

export function HostSettingsDialog({
  host,
  onClose
}: {
  host: Host
  onClose(): void
}): React.JSX.Element {
  const { refresh } = useAppState()
  const [label, setLabel] = useState(host.label)
  const [isProtected, setIsProtected] = useState(host.protected)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api.hosts.update(host.id, { label: label.trim(), protected: isProtected })
      await refresh()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent aria-label="Host settings" aria-labelledby={undefined} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Host settings</DialogTitle>
          <DialogDescription className="sr-only">
            Label, protection and git access for this host.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="host-ssh">SSH host</FieldLabel>
              <Input id="host-ssh" className="bg-muted font-mono" value={host.sshHost} readOnly />
            </Field>
            <Field>
              <FieldLabel htmlFor="host-label">Label</FieldLabel>
              <Input
                id="host-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                autoFocus
              />
            </Field>
          </div>
          <div className="flex items-start gap-2.5 rounded-lg border border-border p-2.5">
            <Checkbox
              id="host-protected"
              className="mt-0.5"
              aria-describedby="host-protected-hint"
              checked={isProtected}
              onCheckedChange={(checked) => setIsProtected(checked === true)}
            />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="host-protected">Protected host</Label>
              <div id="host-protected-hint" className="text-muted-foreground">
                Require typing the host name before dangerous commands
              </div>
            </div>
          </div>
        </FieldGroup>
        <Separator />
        <HostGitAccessPanel host={host} onClose={onClose} />
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !label.trim()}>
            {busy ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
