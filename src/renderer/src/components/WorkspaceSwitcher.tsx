import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FolderGit2, MoreHorizontal } from 'lucide-react'
import type { Workspace } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { useOpenSettings } from '../settingsOpener'
import { Button, IconButton } from './ui'
import { AddExistingDialog } from './AddExistingDialog'
import { CloneDialog } from './CloneDialog'
import { RemoveWorkspaceDialog } from './RemoveDialogs'

export function WorkspaceSwitcher(): React.JSX.Element {
  const { statuses, repos, workspaces, activeHostId, activeWorkspaceId, selectWorkspace, refresh } =
    useAppState()
  const openSettings = useOpenSettings()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [cloning, setCloning] = useState(false)
  const [addingExisting, setAddingExisting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [removingWs, setRemovingWs] = useState<{ ws: Workspace; label: string } | null>(null)

  const labelOf = (w: Workspace): string => {
    const repo = repos.find((r) => r.id === w.repoId)
    return repo ? `${repo.owner}/${repo.name}` : w.repoId
  }
  const hostWorkspaces = workspaces.filter((w) => w.hostId === activeHostId)
  const active = hostWorkspaces.find((w) => w.id === activeWorkspaceId)
  const connected = activeHostId !== null && statuses[activeHostId]?.state === 'connected'
  const hostIds = activeHostId !== null ? [activeHostId] : []

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

  return (
    <div className="switcher" ref={rootRef}>
      <Button
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
      </Button>
      {open && (
        <div className="switcher-panel">
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
                  <IconButton
                    aria-label={`Workspace menu ${label}`}
                    onClick={() => setMenu(menu === wsMenu ? null : wsMenu)}
                  >
                    <MoreHorizontal size={14} />
                  </IconButton>
                  {menu === wsMenu && (
                    <div className="menu">
                      <Button
                        onClick={() => {
                          setMenu(null)
                          setOpen(false)
                          openSettings('repositories', w.repoId)
                        }}
                      >
                        Repo settings…
                      </Button>
                      <Button
                        onClick={() => {
                          setMenu(null)
                          void run(() => api.workspaces.rebuildMirror(w.repoId, w.id))
                        }}
                      >
                        Rebuild mirror
                      </Button>
                      <Button
                        onClick={() => {
                          setMenu(null)
                          setRemovingWs({ ws: w, label })
                        }}
                      >
                        Remove workspace
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {actionError && <div className="error pad">{actionError}</div>}
          <div className="switcher-footer">
            <Button disabled={!connected} onClick={() => setCloning(true)}>
              ＋ Clone repo…
            </Button>
            <Button disabled={!connected} onClick={() => setAddingExisting(true)}>
              ＋ Add existing repo…
            </Button>
          </div>
        </div>
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
          hostIds={hostIds}
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
          hostIds={hostIds}
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
