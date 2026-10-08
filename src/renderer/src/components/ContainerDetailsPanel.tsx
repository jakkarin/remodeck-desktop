import { Eye, EyeOff, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toContainerDetails, type ContainerDetails } from '../../../shared/containerDetails'
import type { ContainerInfo } from '../../../shared/containers'
import type { Host } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { dangerLevel } from '../danger'
import { Button, IconButton } from './ui'

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
    <ul className="details-list mono">
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
    <dl className="details-fields">
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
  if (env.length === 0) return <div className="muted">No environment variables</div>
  const toggle = (i: number): void =>
    setShown((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })
  return (
    <ul className="details-env">
      {env.map((e, i) => {
        const on = shown.has(i)
        return (
          <li key={`${i}:${e.key}`}>
            <span className="mono details-env-text">
              {e.key} = <span>{on ? e.value : '••••••'}</span>
            </span>
            <IconButton
              aria-label={`${on ? 'Hide' : 'Show'} ${e.key}`}
              aria-pressed={on}
              onClick={() => toggle(i)}
            >
              {on ? <EyeOff size={14} /> : <Eye size={14} />}
            </IconButton>
          </li>
        )
      })}
    </ul>
  )
}

export function ContainerDetailsPanel({
  host,
  container,
  onClose
}: {
  host: Host
  container: ContainerInfo
  onClose: () => void
}): React.JSX.Element {
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
    <aside ref={ref} className="details-panel" aria-label={`Details for ${container.name}`}>
      <div className="details-header">
        <span className="container-name mono">{container.name}</span>
        <IconButton aria-label="Close details" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      <div role="tablist" className="details-tabs">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`details-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="details-body"
            className="details-tab"
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
        className="details-body"
      >
        {error !== null && (
          <div>
            <div className="error">{error}</div>
            <Button
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
        {error === null && details === null && <div className="muted">Loading…</div>}
        {error === null && details !== null && tab === 'overview' && (
          <Overview d={details.overview} />
        )}
        {error === null && details !== null && tab === 'env' && <Env env={details.env} />}
        {error === null && details !== null && tab === 'json' && (
          <pre className="details-json mono">{details.json}</pre>
        )}
      </div>
    </aside>
  )
}
