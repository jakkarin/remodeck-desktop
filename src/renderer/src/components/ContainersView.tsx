import { useState } from 'react'
import { ChevronDown, ChevronRight, Play, RotateCw, Square, Trash2 } from 'lucide-react'
import type { ContainerAction, ContainerInfo } from '../../../shared/containers'
import { groupContainers } from '../../../shared/containers'
import type { Host } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { dangerLevel } from '../danger'
import { readJson, writeJson } from '../storage'
import { useContainers } from '../useContainers'
import { ConfirmDanger } from './ConfirmDanger'
import { ErrorBanner } from './ErrorBanner'
import { Badge, Button, IconButton, TextInput } from './ui'

const COLLAPSED_KEY = 'remodeck.composeCollapsed'
const ACTIVE: readonly string[] = ['running', 'restarting', 'paused']

const isActive = (c: ContainerInfo): boolean => ACTIVE.includes(c.state)
const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

type Pending = {
  hostId: string
  container: ContainerInfo
  action: ContainerAction
  mode: 'click' | 'type'
}

export function ContainersView({ host }: { host: Host }): React.JSX.Element {
  const { list, live, error, retry } = useContainers(host.id)
  const [filter, setFilter] = useState('')
  const [showStopped, setShowStopped] = useState(false)
  const [collapsedAll, setCollapsedAll] = useState<Record<string, string[]>>(() =>
    readJson<Record<string, string[]>>(COLLAPSED_KEY, {})
  )
  const [actionError, setActionError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  const collapsed = collapsedAll[host.id] ?? []
  const toggleProject = (name: string): void => {
    const next = collapsed.includes(name)
      ? collapsed.filter((n) => n !== name)
      : [...collapsed, name]
    const all = { ...collapsedAll, [host.id]: next }
    setCollapsedAll(all)
    writeJson(COLLAPSED_KEY, all)
  }

  // A confirm opened for another host must never act on this one.
  const stale = pending !== null && pending.hostId !== host.id
  if (stale) setPending(null)

  const run = async (c: ContainerInfo, action: ContainerAction): Promise<void> => {
    await api.containers.action(host.id, c.id, action)
    setActionError(null)
  }
  const request = (c: ContainerInfo, action: ContainerAction): void => {
    const level = dangerLevel(action, host.protected)
    if (level === 'none') {
      const mark = (on: boolean): void =>
        setBusy((s) => {
          const n = new Set(s)
          if (on) n.add(c.id)
          else n.delete(c.id)
          return n
        })
      mark(true)
      run(c, action)
        .catch((e) => setActionError(errorMessage(e)))
        .finally(() => mark(false))
    } else {
      setPending({ hostId: host.id, container: c, action, mode: level })
    }
  }

  if (error !== null) {
    return (
      <div className="containers-view">
        <ErrorBanner message={`เชื่อมต่อ docker บน ${host.label} ไม่ได้`} />
        <div className="error">{error}</div>
        <Button onClick={retry}>Retry</Button>
      </div>
    )
  }
  if (list === null) return <div className="containers-view muted">กำลังโหลด…</div>

  const needle = filter.trim().toLowerCase()
  const visible = list.filter(
    (c) =>
      (showStopped || isActive(c)) &&
      (needle === '' ||
        c.name.toLowerCase().includes(needle) ||
        c.image.toLowerCase().includes(needle))
  )
  const { projects, standalone } = groupContainers(visible)

  const row = (c: ContainerInfo): React.JSX.Element => (
    <li key={c.id} className="container-row">
      <span className={`state-dot state-${c.state}`} title={c.state} aria-hidden="true" />
      <span className="container-name mono">{c.name}</span>
      <span className="container-image muted">{c.image}</span>
      <span className="container-ports muted">{c.ports.join(', ')}</span>
      <span className="container-status muted">{c.status}</span>
      <span className="container-actions">
        {isActive(c) ? (
          <>
            <IconButton
              aria-label={`Stop ${c.name}`}
              disabled={busy.has(c.id)}
              onClick={() => request(c, 'stop')}
            >
              <Square size={14} />
            </IconButton>
            <IconButton
              aria-label={`Restart ${c.name}`}
              disabled={busy.has(c.id)}
              onClick={() => request(c, 'restart')}
            >
              <RotateCw size={14} />
            </IconButton>
          </>
        ) : (
          <IconButton
            aria-label={`Start ${c.name}`}
            disabled={busy.has(c.id)}
            onClick={() => request(c, 'start')}
          >
            <Play size={14} />
          </IconButton>
        )}
        <IconButton
          aria-label={`Remove ${c.name}`}
          disabled={busy.has(c.id)}
          onClick={() => request(c, 'remove')}
        >
          <Trash2 size={14} />
        </IconButton>
      </span>
    </li>
  )

  return (
    <div className="containers-view">
      <div className="containers-toolbar">
        <TextInput
          aria-label="Filter containers"
          placeholder="Filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={showStopped}
            onChange={(e) => setShowStopped(e.target.checked)}
          />
          แสดงตัวที่หยุด
        </label>
        {!live && <Badge tone="warning">หยุดอัปเดตสด</Badge>}
      </div>
      {actionError && <ErrorBanner message={actionError} />}
      {list.length === 0 && <div className="muted">{`ยังไม่มี container บน ${host.label}`}</div>}
      {list.length > 0 && visible.length === 0 && (
        <div className="muted">ไม่มี container ที่ตรงกับตัวกรอง</div>
      )}
      {projects.map((p) => {
        const isCollapsed = collapsed.includes(p.name)
        return (
          <section key={p.name} className="container-group">
            <button
              type="button"
              className="container-group-header"
              aria-expanded={!isCollapsed}
              onClick={() => toggleProject(p.name)}
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <span>{`${p.name} (compose)`}</span>
            </button>
            {!isCollapsed && <ul>{p.containers.map(row)}</ul>}
          </section>
        )
      })}
      {standalone.length > 0 && (
        <section className="container-group">
          <div className="container-group-header">Standalone</div>
          <ul>{standalone.map(row)}</ul>
        </section>
      )}
      {pending && !stale && (
        <ConfirmDanger
          host={host}
          summary={`${pending.action} · ${pending.container.name}`}
          confirmLabel={capitalise(pending.action)}
          mode={pending.mode}
          onConfirm={async () => {
            if (pending.hostId !== host.id) throw new Error('host changed')
            await run(pending.container, pending.action)
          }}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}
