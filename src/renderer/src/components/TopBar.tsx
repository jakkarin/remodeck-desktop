import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { Button } from './ui/button'
import { HostSelector } from './HostSelector'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

function syncLabel(elapsedMs: number): string {
  const s = Math.max(0, Math.floor(elapsedMs / 1000))
  if (s < 60) return `Sync · ${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `Sync · ${m}m`
  return `Sync · ${Math.floor(m / 60)}h`
}

export function TopBar({ now = Date.now }: { now?: () => number }): React.JSX.Element {
  const { workspaces, statuses, activeWorkspaceId, syncInfo, activeModule } = useAppState()
  const [, setTick] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const active = workspaces.find((w) => w.id === activeWorkspaceId)
  const hostState = active ? (statuses[active.hostId]?.state ?? 'disconnected') : null
  const hostDown = hostState === 'disconnected' || hostState === 'error'
  const info = active ? syncInfo[active.id] : undefined
  const label = info ? syncLabel(now() - info.at) : 'Sync'

  const sync = async (): Promise<void> => {
    if (!active) return
    setPending(true)
    setError(null)
    try {
      await api.workspaces.sync(active.id)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  const title = hostDown ? 'Host is not connected' : info?.error
  return (
    <header className="relative flex h-[46px] shrink-0 items-center gap-2 border-b bg-background px-3">
      <div
        aria-hidden="true"
        className="mr-2 flex size-[22px] items-center justify-center rounded-md bg-foreground text-xs font-semibold text-background"
      >
        r
      </div>
      {activeModule === 'settings' ? (
        <span className="font-semibold">Settings</span>
      ) : (
        <>
          <HostSelector />
          {activeModule === 'git' && (
            <>
              <span aria-hidden="true" className="text-muted-foreground">
                /
              </span>
              <WorkspaceSwitcher />
            </>
          )}
          <span className="flex-1" />
          {activeModule === 'git' && (
            <Button
              variant="ghost"
              className={`h-[30px] gap-1.5 rounded-lg px-2.5 text-[13px] ${info?.error ? 'warn text-warning' : 'text-foreground'}`}
              disabled={!active || hostDown || pending}
              title={title}
              onClick={() => void sync()}
            >
              <RefreshCw size={14} className={pending ? 'spinning' : undefined} />
              {label}
            </Button>
          )}
        </>
      )}
      {error && (
        <div className="error absolute top-full right-2.5 left-2.5 z-20 rounded border border-destructive bg-background px-2 py-1">
          {error}
        </div>
      )}
    </header>
  )
}
