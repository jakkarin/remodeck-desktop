import { useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Lock,
  Monitor,
  MoreHorizontal,
  Plus,
  Server,
  SlidersHorizontal
} from 'lucide-react'
import { cn } from 'cn'
import { isLocalHost, type Host, type HostState, type HostStatus } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { useReturnFocus } from '../useReturnFocus'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from './ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { AddHostDialog } from './AddHostDialog'
import { HostSettingsDialog } from './HostSettingsDialog'
import { RemoveHostDialog } from './RemoveDialogs'

const DISCONNECTED: HostStatus = { state: 'disconnected' }

const STATE_TEXT: Record<HostState, string> = {
  connected: 'connected',
  disconnected: 'not connected',
  connecting: 'connecting…',
  error: 'error'
}

function StatusDot({ state, title }: { state: HostState; title?: string }): React.JSX.Element {
  return (
    <span
      title={title}
      data-status={state}
      className={cn(
        'size-2 shrink-0 rounded-full',
        state === 'connected' && 'bg-success',
        state === 'disconnected' && 'box-border border-[1.5px] border-muted-foreground/60',
        state === 'connecting' && 'animate-pulse bg-warning',
        state === 'error' && 'bg-destructive'
      )}
    />
  )
}

function ProtectedBadge(): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive-soft px-1.5 py-px text-[10px] font-semibold text-destructive">
      <Lock size={10} aria-hidden="true" />
      protected
    </span>
  )
}

const rowButton =
  'h-[26px] rounded-md border-border bg-background px-2.5 text-xs font-normal text-foreground hover:bg-accent'

export function HostSelector(): React.JSX.Element {
  const { hosts, statuses, workspaces, activeHostId, selectHost, setStatus } = useAppState()
  const [open, setOpen] = useState(false)
  // a dialog is taking focus: do not hand it back to the trigger on close
  const dialogOpening = useRef(false)
  const closeForDialog = (): void => {
    dialogOpening.current = true
    setOpen(false)
  }
  const [adding, setAdding] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [removingHost, setRemovingHost] = useState<Host | null>(null)
  const [editingHost, setEditingHost] = useState<Host | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useReturnFocus(adding || removingHost !== null || editingHost !== null, triggerRef)

  const active = hosts.find((h) => h.id === activeHostId)
  const activeState = active ? (statuses[active.id] ?? DISCONNECTED).state : 'disconnected'

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
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          if (o) dialogOpening.current = false
          setOpen(o)
        }}
      >
        <PopoverTrigger asChild>
          <Button ref={triggerRef} variant="ghost" aria-label="Switch host" className="gap-2 px-2">
            {active ? <StatusDot state={activeState} title={activeState} /> : <Server size={14} />}
            <span>{active ? active.label : 'Select host'}</span>
            {active?.protected && <ProtectedBadge />}
            <ChevronDown size={14} className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          onCloseAutoFocus={(e) => {
            if (dialogOpening.current) e.preventDefault()
            dialogOpening.current = false
          }}
          className="w-[340px] gap-0 rounded-xl bg-popover p-1.5 shadow-lg data-open:duration-[180ms] data-closed:duration-[120ms]"
        >
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Hosts
          </div>
          {hosts.length === 0 && (
            <div className="px-2.5 py-2 text-muted-foreground">No hosts yet</div>
          )}
          {hosts.map((host) => {
            const status = statuses[host.id] ?? DISCONNECTED
            const connected = status.state === 'connected'
            const hasWorkspaces = workspaces.some((w) => w.hostId === host.id)
            const isActive = host.id === activeHostId
            const subId = `host-sub-${host.id}`
            const sub =
              status.state === 'error'
                ? (status.error ?? STATE_TEXT.error)
                : `${isLocalHost(host) ? 'This computer' : `ssh ${host.sshHost}`} · ${STATE_TEXT[status.state]}`
            return (
              <div
                key={host.id}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg pr-1.5 hover:bg-accent',
                  isActive && 'bg-selected hover:bg-selected'
                )}
              >
                <button
                  type="button"
                  aria-current={isActive ? 'true' : undefined}
                  aria-describedby={subId}
                  aria-label={host.label}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  onClick={() => {
                    selectHost(host.id)
                    setOpen(false)
                  }}
                >
                  <StatusDot state={status.state} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-medium">
                      {isLocalHost(host) && (
                        <Monitor
                          size={13}
                          aria-hidden="true"
                          className="shrink-0 text-muted-foreground"
                        />
                      )}
                      <span className="truncate">{host.label}</span>
                      {host.protected && <ProtectedBadge />}
                    </span>
                    <span
                      id={subId}
                      className={cn(
                        'block truncate text-[11px]',
                        status.state === 'error'
                          ? 'text-destructive'
                          : 'font-mono text-muted-foreground'
                      )}
                    >
                      {sub}
                    </span>
                  </span>
                  {isActive && <Check size={14} aria-hidden="true" className="text-(--accent)" />}
                </button>
                {status.state === 'disconnected' && (
                  <Button className={rowButton} onClick={() => void connect(host.id)}>
                    Connect
                  </Button>
                )}
                {status.state === 'error' && (
                  <Button className={rowButton} onClick={() => void connect(host.id)}>
                    Retry
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Settings for ${host.label}`}
                  className="text-muted-foreground"
                  onClick={() => {
                    closeForDialog()
                    setEditingHost(host)
                  }}
                >
                  <SlidersHorizontal />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Host menu ${host.label}`}
                      className="text-muted-foreground"
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-auto min-w-40">
                    {connected && (
                      <DropdownMenuItem onSelect={() => void disconnect(host.id)}>
                        Disconnect
                      </DropdownMenuItem>
                    )}
                    {!isLocalHost(host) && (
                      <DropdownMenuItem
                        disabled={hasWorkspaces}
                        title={
                          hasWorkspaces ? 'Remove the workspaces on this host first' : undefined
                        }
                        className="data-disabled:pointer-events-auto"
                        onSelect={() => {
                          closeForDialog()
                          setRemovingHost(host)
                        }}
                      >
                        Remove host…
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          })}
          {actionError && <div className="px-2.5 py-1.5 text-destructive">{actionError}</div>}
          <div className="mx-1 my-1.5 h-px bg-border" />
          <Button
            variant="ghost"
            className="h-auto justify-start gap-2.5 rounded-lg px-2.5 py-2 text-xs font-normal"
            onClick={() => {
              closeForDialog()
              setAdding(true)
            }}
          >
            <Plus size={16} className="text-muted-foreground" /> Add host…
          </Button>
        </PopoverContent>
      </Popover>
      {adding && <AddHostDialog onClose={() => setAdding(false)} />}
      {editingHost && (
        <HostSettingsDialog host={editingHost} onClose={() => setEditingHost(null)} />
      )}
      {removingHost && (
        <RemoveHostDialog host={removingHost} onClose={() => setRemovingHost(null)} />
      )}
    </>
  )
}
