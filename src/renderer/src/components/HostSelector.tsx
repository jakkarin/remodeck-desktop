import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Lock, MoreHorizontal, Plus, Server } from 'lucide-react'
import type { Host, HostStatus } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { Button, IconButton } from './ui'
import { AddHostDialog } from './AddHostDialog'
import { HostSettingsDialog } from './HostSettingsDialog'
import { RemoveHostDialog } from './RemoveDialogs'

const DISCONNECTED: HostStatus = { state: 'disconnected' }

function ProtectedBadge(): React.JSX.Element {
  return (
    <span className="protected-badge">
      <Lock size={12} aria-hidden="true" />
      protected
    </span>
  )
}

export function HostSelector(): React.JSX.Element {
  const { hosts, statuses, workspaces, activeHostId, selectHost, setStatus } = useAppState()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [removingHost, setRemovingHost] = useState<Host | null>(null)
  const [editingHost, setEditingHost] = useState<Host | null>(null)

  const active = hosts.find((h) => h.id === activeHostId)
  const activeState = active ? (statuses[active.id] ?? DISCONNECTED).state : 'disconnected'

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
      <Button
        className="switcher-trigger"
        aria-label="Switch host"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o)
          setMenu(null)
        }}
      >
        {active ? (
          <span className={`dot ${activeState}`} title={activeState} />
        ) : (
          <Server size={14} />
        )}
        <span>{active ? active.label : 'Select host'}</span>
        {active?.protected && <ProtectedBadge />}
        <ChevronDown size={14} />
      </Button>
      {open && (
        <div className="switcher-panel">
          {hosts.length === 0 && <div className="muted pad">No hosts yet</div>}
          {hosts.map((host) => {
            const status = statuses[host.id] ?? DISCONNECTED
            const connected = status.state === 'connected'
            const hasWorkspaces = workspaces.some((w) => w.hostId === host.id)
            const hostMenu = `host:${host.id}`
            return (
              <section key={host.id} className={host.id === activeHostId ? 'host active' : 'host'}>
                <div className="host-row">
                  <span className={`dot ${status.state}`} title={status.state} />
                  <Button
                    variant="ghost"
                    className="host-label"
                    onClick={() => {
                      selectHost(host.id)
                      setOpen(false)
                    }}
                  >
                    {host.label}
                  </Button>
                  {host.protected && <ProtectedBadge />}
                  {status.state === 'disconnected' && (
                    <Button onClick={() => void connect(host.id)}>Connect</Button>
                  )}
                  {status.state === 'error' && (
                    <Button onClick={() => void connect(host.id)}>Retry</Button>
                  )}
                  <IconButton
                    aria-label={`Host menu ${host.label}`}
                    onClick={() => setMenu(menu === hostMenu ? null : hostMenu)}
                  >
                    <MoreHorizontal size={14} />
                  </IconButton>
                </div>
                {menu === hostMenu && (
                  <div className="menu">
                    <Button
                      onClick={() => {
                        setMenu(null)
                        setEditingHost(host)
                      }}
                    >
                      Host settings…
                    </Button>
                    {connected && (
                      <Button
                        onClick={() => {
                          setMenu(null)
                          void disconnect(host.id)
                        }}
                      >
                        Disconnect
                      </Button>
                    )}
                    <Button
                      disabled={hasWorkspaces}
                      title={hasWorkspaces ? 'Remove the workspaces on this host first' : undefined}
                      onClick={() => {
                        setMenu(null)
                        setRemovingHost(host)
                      }}
                    >
                      Remove host
                    </Button>
                  </div>
                )}
                {status.state === 'error' && status.error && (
                  <div className="error">{status.error}</div>
                )}
              </section>
            )
          })}
          {actionError && <div className="error pad">{actionError}</div>}
          <div className="switcher-footer">
            <Button onClick={() => setAdding(true)}>
              <Plus size={14} /> Add host
            </Button>
          </div>
        </div>
      )}
      {adding && <AddHostDialog onClose={() => setAdding(false)} />}
      {editingHost && (
        <HostSettingsDialog host={editingHost} onClose={() => setEditingHost(null)} />
      )}
      {removingHost && (
        <RemoveHostDialog host={removingHost} onClose={() => setRemovingHost(null)} />
      )}
    </div>
  )
}
