import { useContext, useEffect, useState } from 'react'
import type { ApprovalDecision, ApprovalRequest, RefUpdate } from '../../../shared/types'
import { api } from '../api'
import { AppStateContext } from '../state'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from './ui/alert-dialog'
import { Button } from './ui/button'

/** Main denies on its own after this long; the modal drops the request at the same point. */
const APPROVAL_TIMEOUT_MS = 60_000

const ZERO_SHA = /^0+$/

function formatUpdate(u: RefUpdate): string {
  const old = ZERO_SHA.test(u.oldSha) ? '(new branch)' : u.oldSha.slice(0, 7)
  return `${u.ref}: ${old} → ${u.newSha.slice(0, 7)}`
}

export function ApprovalModal(): React.JSX.Element | null {
  const [queue, setQueue] = useState<ApprovalRequest[]>([])
  const appState = useContext(AppStateContext)

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const off = api.on('approval-request', (req) => {
      setQueue((q) => [...q, req])
      const t = setTimeout(() => {
        timers.delete(t)
        setQueue((q) => q.filter((r) => r.id !== req.id))
      }, APPROVAL_TIMEOUT_MS)
      timers.add(t)
    })
    return () => {
      off()
      for (const t of timers) clearTimeout(t)
    }
  }, [])

  const req = queue[0]
  if (!req) return null

  function respond(decision: ApprovalDecision): void {
    api.approval.respond(req.id, decision)
    setQueue((q) => q.filter((r) => r.id !== req.id))
    // 'always' persists alwaysAllowPush in main: reload so Settings shows it.
    if (decision === 'always') void appState?.refresh().catch(() => undefined)
  }

  return (
    <AlertDialog open>
      <AlertDialogContent
        aria-label="Push approval"
        aria-labelledby={undefined}
        className="sm:max-w-md"
        // An approval must be answered with a button; Escape never dismisses it.
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Push approval requested</AlertDialogTitle>
          <AlertDialogDescription>
            {req.repoLabel} <span className="text-muted-foreground">({req.tabLabel})</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="m-0 flex list-none flex-col gap-1 rounded-lg bg-ground p-2">
          {req.updates.map((u) => (
            <li key={u.ref}>
              <code className="font-mono text-xs">{formatUpdate(u)}</code>
            </li>
          ))}
        </ul>
        {queue.length > 1 && (
          <p className="m-0 text-xs text-muted-foreground">{queue.length - 1} more waiting</p>
        )}
        <AlertDialogFooter className="sm:flex-col sm:justify-stretch">
          <Button className="w-full" onClick={() => respond('once')}>
            Allow once
          </Button>
          <div className="flex gap-1.5">
            <Button variant="outline" className="flex-1" onClick={() => respond('session')}>
              Allow for this session
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => respond('always')}>
              Always allow for this repo
            </Button>
          </div>
          <Button variant="destructive" className="w-full" onClick={() => respond('deny')}>
            Deny
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
