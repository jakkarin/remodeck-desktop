import { useState } from 'react'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { Button } from './ui'
import { AddHostDialog } from './AddHostDialog'
import { CloneDialog } from './CloneDialog'

/** Spec §4: nothing to show yet — no hosts, or hosts without a workspace. */
export function EmptyState(): React.JSX.Element {
  const { hosts, statuses, setStatus, refresh, selectWorkspace } = useAppState()
  const [adding, setAdding] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connectedIds = hosts.filter((h) => statuses[h.id]?.state === 'connected').map((h) => h.id)
  const first = hosts[0]

  async function connect(): Promise<void> {
    if (!first) return
    setError(null)
    try {
      setStatus(first.id, await api.hosts.connect(first.id))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="empty-state">
      {hosts.length === 0 ? (
        <>
          <h2>เพิ่ม sandbox แรก</h2>
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add host
          </Button>
        </>
      ) : (
        <>
          <h2>ยังไม่มี workspace</h2>
          {connectedIds.length > 0 ? (
            <Button variant="primary" onClick={() => setCloning(true)}>
              Clone repo
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void connect()}>
              Connect
            </Button>
          )}
        </>
      )}
      {error && <div className="error">{error}</div>}
      {adding && <AddHostDialog onClose={() => setAdding(false)} />}
      {cloning && (
        <CloneDialog
          hostIds={connectedIds}
          onClose={() => setCloning(false)}
          onCloned={(w) => {
            setCloning(false)
            void refresh()
              .catch(() => undefined)
              .then(() => selectWorkspace(w.id))
          }}
        />
      )}
    </div>
  )
}
