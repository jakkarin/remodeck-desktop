import { useState } from 'react'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { AddHostDialog } from './AddHostDialog'
import { CloneDialog } from './CloneDialog'

export function Sidebar(): React.JSX.Element {
  const { hosts, statuses, repos, workspaces, selected, select, setStatus, refresh } = useAppState()
  const [cloneHost, setCloneHost] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const connect = async (hostId: string): Promise<void> => {
    setActionError(null)
    try {
      setStatus(hostId, await api.hosts.connect(hostId))
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }
  const disconnect = async (hostId: string): Promise<void> => {
    setActionError(null)
    try {
      await api.hosts.disconnect(hostId)
      setStatus(hostId, await api.hosts.status(hostId))
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-tree">
        {hosts.length === 0 && <div className="muted pad">No hosts yet</div>}
        {hosts.map((host) => {
          const status = statuses[host.id] ?? { state: 'disconnected' as const, warnings: [] }
          const connected = status.state === 'connected'
          return (
            <section key={host.id} className="host">
              <div className="host-row">
                <span className={`dot ${status.state}`} title={status.state} />
                <span className="host-label">{host.label}</span>
              </div>
              <div className="host-actions">
                {connected ? (
                  <button onClick={() => void disconnect(host.id)}>Disconnect</button>
                ) : status.state === 'error' ? (
                  <button onClick={() => void connect(host.id)}>Reload</button>
                ) : (
                  <button
                    onClick={() => void connect(host.id)}
                    disabled={status.state === 'connecting'}
                  >
                    Connect
                  </button>
                )}
                <button disabled={!connected} onClick={() => setCloneHost(host.id)}>
                  Clone
                </button>
              </div>
              {status.state === 'error' && status.error && (
                <div className="error">{status.error}</div>
              )}
              {status.warnings.length > 0 && (
                <ul className="warnings">
                  {status.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              <ul className="workspaces">
                {workspaces
                  .filter((w) => w.hostId === host.id)
                  .map((w) => {
                    const repo = repos.find((r) => r.id === w.repoId)
                    const text = `${repo ? `${repo.owner}/${repo.name}` : w.repoId} · ${w.sandboxPath}`
                    const active = selected.kind === 'workspace' && selected.id === w.id
                    return (
                      <li
                        key={w.id}
                        className={active ? 'active' : ''}
                        onClick={() => select({ kind: 'workspace', id: w.id })}
                      >
                        {text}
                      </li>
                    )
                  })}
              </ul>
            </section>
          )
        })}
        {actionError && <div className="error pad">{actionError}</div>}
      </div>
      <div className="sidebar-footer">
        <button onClick={() => setAdding(true)}>Add host</button>
        <button
          className={selected.kind === 'settings' ? 'active' : ''}
          onClick={() => select({ kind: 'settings' })}
        >
          Settings
        </button>
      </div>
      {adding && <AddHostDialog onClose={() => setAdding(false)} />}
      {cloneHost && (
        <CloneDialog
          hostId={cloneHost}
          onClose={() => setCloneHost(null)}
          onCloned={(w) => {
            setCloneHost(null)
            void refresh()
              .catch(() => undefined)
              .then(() => select({ kind: 'workspace', id: w.id }))
          }}
        />
      )}
    </aside>
  )
}
