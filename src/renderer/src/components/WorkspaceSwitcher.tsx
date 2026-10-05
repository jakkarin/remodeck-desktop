import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FolderGit2, MoreHorizontal, Plus } from 'lucide-react'
import type { Host, HostStatus, Workspace } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { AddHostDialog } from './AddHostDialog'
import { AddExistingDialog } from './AddExistingDialog'
import { CloneDialog } from './CloneDialog'
import { RemoveHostDialog, RemoveWorkspaceDialog } from './RemoveDialogs'

const DISCONNECTED: HostStatus = { state: 'disconnected', warnings: [] }

export function WorkspaceSwitcher(): React.JSX.Element {
  const {
    hosts,
    statuses,
    repos,
    workspaces,
    activeWorkspaceId,
    selectWorkspace,
    setStatus,
    refresh
  } = useAppState()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [cloning, setCloning] = useState(false)
  const [addingExisting, setAddingExisting] = useState(false)
  const [adding, setAdding] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [removingHost, setRemovingHost] = useState<Host | null>(null)
  const [removingWs, setRemovingWs] = useState<{ ws: Workspace; label: string } | null>(null)

  const labelOf = (w: Workspace): string => {
    const repo = repos.find((r) => r.id === w.repoId)
    return repo ? `${repo.owner}/${repo.name}` : w.repoId
  }
  const active = workspaces.find((w) => w.id === activeWorkspaceId)
  const connectedIds = hosts.filter((h) => statuses[h.id]?.state === 'connected').map((h) => h.id)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onPointer = (e: globalThis.PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const run = async (action: () => Promise<void>): Promise<void> => {
    setActionError(null)
    try {
      await action()
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }
  const connect = (hostId: string): Promise<void> =>
    run(async () => setStatus(hostId, await api.hosts.connect(hostId)))
  const disconnect = (hostId: string): Promise<void> =>
    run(async () => {
      await api.hosts.disconnect(hostId)
      setStatus(hostId, await api.hosts.status(hostId))
    })

  return (
    <div className="switcher" ref={rootRef}>
      <button
        className="switcher-trigger"
        aria-label="Switch workspace"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o)
          setMenu(null)
        }}
      >
        <FolderGit2 size={14} />
        <span>{active ? labelOf(active) : 'Select workspace'}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="switcher-panel">
          {hosts.length === 0 && <div className="muted pad">No hosts yet</div>}
          {hosts.map((host) => {
            const status = statuses[host.id] ?? DISCONNECTED
            const connected = status.state === 'connected'
            const hostWorkspaces = workspaces.filter((w) => w.hostId === host.id)
            const hostMenu = `host:${host.id}`
            return (
              <section key={host.id} className="host">
                <div className="host-row">
                  <span className={`dot ${status.state}`} title={status.state} />
                  <span className="host-label">{host.label}</span>
                  {status.state === 'disconnected' && (
                    <button onClick={() => void connect(host.id)}>Connect</button>
                  )}
                  {status.state === 'error' && (
                    <button onClick={() => void connect(host.id)}>Retry</button>
                  )}
                  <button
                    className="icon-btn"
                    aria-label={`Host menu ${host.label}`}
                    onClick={() => setMenu(menu === hostMenu ? null : hostMenu)}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>
                {menu === hostMenu && (
                  <div className="menu">
                    {connected && (
                      <button
                        onClick={() => {
                          setMenu(null)
                          void disconnect(host.id)
                        }}
                      >
                        Disconnect
                      </button>
                    )}
                    <button
                      disabled={hostWorkspaces.length > 0}
                      title={
                        hostWorkspaces.length > 0 ? 'ลบ workspace ของ host นี้ก่อน' : undefined
                      }
                      onClick={() => {
                        setMenu(null)
                        setRemovingHost(host)
                      }}
                    >
                      Remove host
                    </button>
                  </div>
                )}
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
                  {hostWorkspaces.map((w) => {
                    const label = labelOf(w)
                    const wsMenu = `ws:${w.id}`
                    return (
                      <li
                        key={w.id}
                        className={`${w.id === activeWorkspaceId ? 'active' : ''} ${connected ? '' : 'dim'}`.trim()}
                      >
                        <span
                          className="ws-label"
                          onClick={() => {
                            selectWorkspace(w.id)
                            setOpen(false)
                          }}
                        >
                          {`${label} · ${w.sandboxPath}`}
                        </span>
                        <button
                          className="icon-btn"
                          aria-label={`Workspace menu ${label}`}
                          onClick={() => setMenu(menu === wsMenu ? null : wsMenu)}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {menu === wsMenu && (
                          <div className="menu">
                            <button
                              onClick={() => {
                                setMenu(null)
                                void run(() => api.workspaces.rebuildMirror(w.repoId, w.id))
                              }}
                            >
                              Rebuild mirror
                            </button>
                            <button
                              onClick={() => {
                                setMenu(null)
                                setRemovingWs({ ws: w, label })
                              }}
                            >
                              Remove workspace
                            </button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
          {actionError && <div className="error pad">{actionError}</div>}
          <div className="switcher-footer">
            <button disabled={connectedIds.length === 0} onClick={() => setCloning(true)}>
              ＋ Clone repo…
            </button>
            <button disabled={connectedIds.length === 0} onClick={() => setAddingExisting(true)}>
              ＋ Add existing repo…
            </button>
            <button onClick={() => setAdding(true)}>
              <Plus size={14} /> Add host
            </button>
          </div>
        </div>
      )}
      {adding && <AddHostDialog onClose={() => setAdding(false)} />}
      {removingHost && (
        <RemoveHostDialog host={removingHost} onClose={() => setRemovingHost(null)} />
      )}
      {removingWs && (
        <RemoveWorkspaceDialog
          workspace={removingWs.ws}
          label={removingWs.label}
          onClose={() => setRemovingWs(null)}
        />
      )}
      {addingExisting && (
        <AddExistingDialog
          hostIds={connectedIds}
          onClose={() => setAddingExisting(false)}
          onAdded={(w) => {
            setAddingExisting(false)
            void refresh()
              .catch(() => undefined)
              .then(() => selectWorkspace(w.id))
          }}
        />
      )}
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
