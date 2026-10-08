import { useState } from 'react'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { Button } from './ui'
import { AddHostDialog } from './AddHostDialog'
import { CloneDialog } from './CloneDialog'

/** Spec §4: nothing to show yet — no hosts, or hosts without a workspace. */
export function EmptyState(): React.JSX.Element {
  const { hosts, statuses, activeHostId, setStatus, refresh, selectWorkspace } = useAppState()
  const [adding, setAdding] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const host = hosts.find((h) => h.id === activeHostId)
  const connected = host !== undefined && statuses[host.id]?.state === 'connected'
  const connectedIds = host && connected ? [host.id] : []

  async function connect(): Promise<void> {
    if (!host) return
    setError(null)
    try {
      setStatus(host.id, await api.hosts.connect(host.id))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="empty-state">
      {!host ? (
        <>
          <h2>Add your first sandbox</h2>
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add host
          </Button>
        </>
      ) : (
        <>
          <h2>No workspaces yet</h2>
          {connected ? (
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
