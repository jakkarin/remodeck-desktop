import { useEffect, useState } from 'react'
import type { ApprovalDecision, ApprovalRequest, RefUpdate } from '../../../shared/types'
import { api } from '../api'

/** Main denies on its own after this long; the modal drops the request at the same point. */
const APPROVAL_TIMEOUT_MS = 60_000

const ZERO_SHA = /^0+$/

function formatUpdate(u: RefUpdate): string {
  const old = ZERO_SHA.test(u.oldSha) ? '(new branch)' : u.oldSha.slice(0, 7)
  return `${u.ref}: ${old} → ${u.newSha.slice(0, 7)}`
}

export function ApprovalModal(): React.JSX.Element | null {
  const [queue, setQueue] = useState<ApprovalRequest[]>([])

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
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label="Push approval">
        <h3>Push approval requested</h3>
        <p>
          {req.repoLabel} <span className="dim">({req.tabLabel})</span>
        </p>
        <ul className="approval-updates">
          {req.updates.map((u) => (
            <li key={u.ref}>
              <code>{formatUpdate(u)}</code>
            </li>
          ))}
        </ul>
        {queue.length > 1 && <p className="dim">{queue.length - 1} more waiting</p>}
        <div className="modal-actions">
          <button onClick={() => respond('once')}>Allow once</button>
          <button onClick={() => respond('session')}>Allow for this session</button>
          <button onClick={() => respond('always')}>Always allow for this repo</button>
          <button onClick={() => respond('deny')}>Deny</button>
        </div>
      </div>
    </div>
  )
}
