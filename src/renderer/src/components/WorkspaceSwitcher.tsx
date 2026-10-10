import { useRef, useState } from 'react'
import { ChevronDown, FolderGit2, MoreHorizontal, Plus, Search } from 'lucide-react'
import { cn } from 'cn'
import type { Workspace } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { useOpenSettings } from '../settingsOpener'
import { useReturnFocus } from '../useReturnFocus'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { AddExistingDialog } from './AddExistingDialog'
import { CloneDialog } from './CloneDialog'
import { RemoveWorkspaceDialog } from './RemoveDialogs'

const footerButton = 'h-auto justify-start gap-2.5 rounded-lg px-2.5 py-2 text-xs font-normal'

export function WorkspaceSwitcher(): React.JSX.Element {
  const { statuses, repos, workspaces, activeHostId, activeWorkspaceId, selectWorkspace, refresh } =
    useAppState()
  const openSettings = useOpenSettings()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  // a dialog is taking focus: do not hand it back to the trigger on close
  const dialogOpening = useRef(false)
  const closeForDialog = (): void => {
    dialogOpening.current = true
    setOpen(false)
  }
  const [cloning, setCloning] = useState(false)
  const [addingExisting, setAddingExisting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [removingWs, setRemovingWs] = useState<{ ws: Workspace; label: string } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useReturnFocus(cloning || addingExisting || removingWs !== null, triggerRef)

  const labelOf = (w: Workspace): string => {
    const repo = repos.find((r) => r.id === w.repoId)
    return repo ? `${repo.owner}/${repo.name}` : w.repoId
  }
  const hostWorkspaces = workspaces.filter((w) => w.hostId === activeHostId)
  const active = hostWorkspaces.find((w) => w.id === activeWorkspaceId)
  const connected = activeHostId !== null && statuses[activeHostId]?.state === 'connected'
  const hostIds = activeHostId !== null ? [activeHostId] : []
  const needle = query.trim().toLowerCase()
  const visible = hostWorkspaces.filter(
    (w) =>
      needle === '' ||
      labelOf(w).toLowerCase().includes(needle) ||
      w.sandboxPath.toLowerCase().includes(needle)
  )
  const choose = (id: string): void => {
    selectWorkspace(id)
    setOpen(false)
  }

  const run = async (action: () => Promise<void>): Promise<void> => {
    setActionError(null)
    try {
      await action()
    } catch (e) {
      setActionError(errorMessage(e))
    }
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          if (o) {
            dialogOpening.current = false
            setQuery('')
          }
          setOpen(o)
        }}
      >
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            aria-label="Switch workspace"
            className="gap-2 px-2"
          >
            <FolderGit2 size={14} />
            <span>{active ? labelOf(active) : 'Select workspace'}</span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            searchRef.current?.focus()
          }}
          onCloseAutoFocus={(e) => {
            if (dialogOpening.current) e.preventDefault()
            dialogOpening.current = false
          }}
          className="w-[380px] gap-0 rounded-xl bg-popover p-1.5 shadow-lg data-open:duration-[180ms] data-closed:duration-[120ms]"
        >
          <div className="relative px-1 pt-0.5 pb-1.5">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute top-[calc(50%-3px)] left-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={searchRef}
              type="text"
              aria-label="Find workspace"
              placeholder="Find workspace"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && visible[0]) {
                  e.preventDefault()
                  choose(visible[0].id)
                }
              }}
              className="h-8 w-full rounded-lg border border-border bg-background pr-2 pl-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {visible.length === 0 && (
              <div className="px-2.5 py-2 text-muted-foreground">
                {hostWorkspaces.length === 0 ? 'No workspaces yet' : 'No matching workspaces'}
              </div>
            )}
            {visible.map((w) => {
              const label = labelOf(w)
              const isActive = w.id === activeWorkspaceId
              return (
                <div
                  key={w.id}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg pr-1.5 hover:bg-accent',
                    isActive && 'bg-selected hover:bg-selected',
                    !connected && 'opacity-55'
                  )}
                >
                  <button
                    type="button"
                    aria-current={isActive ? 'true' : undefined}
                    className="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                    onClick={() => choose(w.id)}
                  >
                    <span className="block truncate font-medium">{label}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {w.sandboxPath}
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Workspace menu ${label}`}
                        className="text-muted-foreground"
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-auto min-w-40">
                      <DropdownMenuItem
                        onSelect={() => {
                          setOpen(false)
                          openSettings('repositories', w.repoId)
                        }}
                      >
                        Repo settings…
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          void run(() => api.workspaces.rebuildMirror(w.repoId, w.id))
                        }
                      >
                        Rebuild mirror
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          closeForDialog()
                          setRemovingWs({ ws: w, label })
                        }}
                      >
                        Remove workspace
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            })}
          </div>
          {actionError && <div className="px-2.5 py-1.5 text-destructive">{actionError}</div>}
          <div className="mx-1 my-1.5 h-px bg-border" />
          <Button
            variant="ghost"
            disabled={!connected}
            className={footerButton}
            onClick={() => {
              closeForDialog()
              setCloning(true)
            }}
          >
            <Plus size={16} className="text-muted-foreground" /> Clone repo…
          </Button>
          <Button
            variant="ghost"
            disabled={!connected}
            className={footerButton}
            onClick={() => {
              closeForDialog()
              setAddingExisting(true)
            }}
          >
            <Plus size={16} className="text-muted-foreground" /> Add existing repo…
          </Button>
        </PopoverContent>
      </Popover>
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
    </>
  )
}
