import { useState } from 'react'
import { TriangleAlertIcon } from 'lucide-react'
import type { Host } from '../../../shared/types'
import { errorMessage } from '../api'
import { Alert, AlertDescription } from './ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle
} from './ui/alert-dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'

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
    <AlertDialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <TriangleAlertIcon />
          </AlertDialogMedia>
          <AlertDialogTitle className="text-base">{host.label}</AlertDialogTitle>
          <AlertDialogDescription>{summary}</AlertDialogDescription>
        </AlertDialogHeader>
        {mode === 'type' && (
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Type the host name to confirm"
            placeholder={host.label}
            autoFocus
          />
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          {/* Not AlertDialogAction: that closes on click, but we stay open until onConfirm settles. */}
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy || !matches}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
