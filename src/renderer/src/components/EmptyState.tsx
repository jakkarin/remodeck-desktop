import { useState } from 'react'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
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
          <button className="primary" onClick={() => setAdding(true)}>
            Add host
          </button>
        </>
      ) : (
        <>
          <h2>ยังไม่มี workspace</h2>
          {connectedIds.length > 0 ? (
            <button className="primary" onClick={() => setCloning(true)}>
              Clone repo
            </button>
          ) : (
            <button className="primary" onClick={() => void connect()}>
              Connect
            </button>
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
