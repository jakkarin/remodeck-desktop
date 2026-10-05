import { useEffect, useState } from 'react'
import { RefreshCw, Settings } from 'lucide-react'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { Button, IconButton } from './ui'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

function syncLabel(elapsedMs: number): string {
  const s = Math.max(0, Math.floor(elapsedMs / 1000))
  if (s < 60) return `Sync · ${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `Sync · ${m}m`
  return `Sync · ${Math.floor(m / 60)}h`
}

export function TopBar({
  onOpenSettings,
  now = Date.now
}: {
  onOpenSettings(): void
  now?: () => number
}): React.JSX.Element {
  const { workspaces, statuses, activeWorkspaceId, syncInfo } = useAppState()
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

  const title = hostDown ? 'Host ยังไม่ได้ connect' : info?.error
  return (
    <header className="topbar">
      <WorkspaceSwitcher />
      <Button
        variant="ghost"
        className={`sync-btn${info?.error ? ' warn' : ''}`}
        disabled={!active || hostDown || pending}
        title={title}
        onClick={() => void sync()}
      >
        <RefreshCw size={14} className={pending ? 'spinning' : undefined} />
        {label}
      </Button>
      <span className="topbar-spacer" />
      <IconButton aria-label="Settings" onClick={onOpenSettings}>
        <Settings size={16} />
      </IconButton>
      {error && <div className="error topbar-error">{error}</div>}
    </header>
  )
}
