import { Eye, EyeOff, Play, RotateCw, ScrollText, Square, SquareTerminal, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toContainerDetails, type ContainerDetails } from '../../../shared/containerDetails'
import type { ContainerAction, ContainerInfo } from '../../../shared/containers'
import type { Host } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { dangerLevel } from '../danger'
import { cn } from 'cn'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { capitalise, stateTone, isActiveContainer, isTransitional } from '../containerPresentation'

const BADGE_VARIANT = {
  neutral: 'secondary',
  success: 'success',
  warning: 'warning',
  danger: 'destructive'
} as const

type Tab = 'overview' | 'env' | 'json'
const TABS: [Tab, string][] = [
  ['overview', 'Overview'],
  ['env', 'Env'],
  ['json', 'JSON']
]
const DASH = '—'

function List({ items }: { items: string[] }): React.JSX.Element {
  if (items.length === 0) return <>{DASH}</>
  return (
    <ul className="m-0 list-none p-0 font-mono text-xs">
      {items.map((s, i) => (
        <li key={`${i}:${s}`}>{s}</li>
      ))}
    </ul>
  )
}

function formatCreated(iso: string): string {
  const t = new Date(iso)
  return Number.isNaN(t.getTime()) ? iso : t.toLocaleString()
}

function Overview({ d }: { d: ContainerDetails['overview'] }): React.JSX.Element {
  const state = d.exitCode === null ? d.state : `${d.state} (exit ${d.exitCode})`
  const field = (label: string, value: React.ReactNode): React.JSX.Element => (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
  return (
    <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs [&_dd]:m-0 [&_dd]:break-words [&_dt]:text-muted-foreground">
      {field('Image', <span className="mono">{d.image || DASH}</span>)}
      {field(
        'Created',
        d.created ? <span title={d.created}>{formatCreated(d.created)}</span> : DASH
      )}
      {field('State', state || DASH)}
      {field('Restart policy', d.restartPolicy)}
      {field('Ports', <List items={d.ports} />)}
      {field(
        'Mounts',
        <List items={d.mounts.map((m) => `${m.source} → ${m.target} (${m.mode})`)} />
      )}
      {field('Networks', <List items={d.networks.map((n) => `${n.name} ${n.ip}`.trim())} />)}
      {field('Labels', <List items={d.labels.map(([k, v]) => `${k}=${v}`)} />)}
    </dl>
  )
}

function Env({ env }: { env: ContainerDetails['env'] }): React.JSX.Element {
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set())
  if (env.length === 0) return <div className="text-muted-foreground">No environment variables</div>
  const toggle = (i: number): void =>
    setShown((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })
  return (
    <ul className="m-0 list-none p-0">
      {env.map((e, i) => {
        const on = shown.has(i)
        return (
          <li key={`${i}:${e.key}`} className="flex items-center justify-between gap-2 py-1">
            <span className="min-w-0 font-mono text-xs break-words">
              {e.key} = <span>{on ? e.value : '••••••'}</span>
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${on ? 'Hide' : 'Show'} ${e.key}`}
              aria-pressed={on}
              onClick={() => toggle(i)}
            >
              {on ? <EyeOff /> : <Eye />}
            </Button>
          </li>
        )
      })}
    </ul>
  )
}

export function ContainerDetailsPanel({
  host,
  container,
  busy = false,
  onAction,
  onTerminal,
  onClose
}: {
  host: Host
  container: ContainerInfo
  busy?: boolean
  onAction?: (action: ContainerAction) => void
  onTerminal?: (kind: 'logs' | 'shell') => void
  onClose: () => void
}): React.JSX.Element {
  const active = isActiveContainer(container)
  const running = container.state === 'running'
  const removing = container.state === 'removing'
  const [tab, setTab] = useState<Tab>('overview')
  const [details, setDetails] = useState<ContainerDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const ref = useRef<HTMLElement>(null)

  // In the stacked layout the panel opens below a long list; bring it into view.
  useEffect(() => {
    const el = ref.current
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  }, [])

  useEffect(() => {
    // `stale` guards against a late result after unmount or a newer fetch.
    let stale = false
    dangerLevel('inspect', host.protected)
    api.containers
      .inspect(host.id, container.id)
      .then((raw) => {
        if (stale) return
        setDetails(toContainerDetails(raw))
        setError(null)
      })
      .catch((e) => {
        if (!stale) setError(errorMessage(e))
      })
    return () => {
      stale = true
    }
  }, [host.id, host.protected, container.id, container.state, attempt])

  return (
    <aside
      ref={ref}
      aria-label={`Details for ${container.name}`}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background"
    >
      <div className="flex shrink-0 flex-col gap-2.5 px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate text-[15px] font-semibold"
            title={container.name}
          >
            {container.name}
          </span>
          <Badge
            variant={BADGE_VARIANT[stateTone[container.state]]}
            data-pulse={isTransitional(container.state) ? 'true' : undefined}
            className={cn(isTransitional(container.state) && 'animate-pulse')}
          >
            {capitalise(container.state)}
          </Badge>
          <Button variant="ghost" size="icon" aria-label="Close details" onClick={onClose}>
            <X />
          </Button>
        </div>
        {onAction && onTerminal && (
          <div className="flex flex-wrap gap-1.5" aria-label="Container actions" role="group">
            {active ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onAction('restart')}
                >
                  <RotateCw /> Restart
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onAction('stop')}
                >
                  <Square /> Stop
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || removing}
                onClick={() => onAction('start')}
              >
                <Play /> Start
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !running}
              onClick={() => onTerminal('shell')}
            >
              <SquareTerminal /> Shell
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onTerminal('logs')}>
              <ScrollText /> Logs
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/30 text-destructive"
              disabled={busy || removing}
              onClick={() => onAction('remove')}
            >
              Remove
            </Button>
          </div>
        )}
      </div>
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-border px-3">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`details-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="details-body"
            className={cn(
              '-mb-px border-b-2 border-transparent px-2.5 py-1.5 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
              tab === id && 'border-(--accent) font-medium text-foreground'
            )}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="details-body"
        role="tabpanel"
        aria-labelledby={`details-tab-${tab}`}
        className="min-h-0 min-w-0 flex-1 overflow-auto px-4 py-3 text-xs"
      >
        {error !== null && (
          <div className="flex flex-col items-start gap-2">
            <div className="text-destructive">{error}</div>
            <Button
              variant="outline"
              onClick={() => {
                setError(null)
                setDetails(null)
                setAttempt((n) => n + 1)
              }}
            >
              Try again
            </Button>
          </div>
        )}
        {error === null && details === null && (
          <div className="text-muted-foreground">Loading…</div>
        )}
        {error === null && details !== null && tab === 'overview' && (
          <Overview d={details.overview} />
        )}
        {error === null && details !== null && tab === 'env' && <Env env={details.env} />}
        {error === null && details !== null && tab === 'json' && (
          <pre className="m-0 font-mono text-xs break-words whitespace-pre-wrap">
            {details.json}
          </pre>
        )}
      </div>
    </aside>
  )
}
