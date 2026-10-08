import { useEffect, useState } from 'react'
import type { ContainerInfo } from '../../../shared/containers'
import { isInUse, type ResourceKind, type ResourceRow } from '../../../shared/resources'
import type { Host } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { Trash2 } from 'lucide-react'
import { formatMem } from '../containerPresentation'
import { dangerLevel, type DangerAction } from '../danger'
import { ConfirmDanger } from './ConfirmDanger'
import { ErrorBanner } from './ErrorBanner'
import { Badge, Button, IconButton, TextInput } from './ui'
import { GroupPanel, ItemRow } from './ui/GroupedList'

const TITLES: Record<ResourceKind, string> = {
  image: 'Images',
  volume: 'Volumes',
  network: 'Networks'
}

const PRUNE_SUMMARY: Record<ResourceKind, string> = {
  image: 'prune images — ลบเฉพาะ image ที่ไม่มี tag (dangling)',
  volume: 'prune volumes — ลบ volume ที่ไม่มี container ใช้ (Docker ≥ 23 ลบเฉพาะ volume ไม่มีชื่อ)',
  network: 'prune networks — ลบ network ที่ไม่มี container ใช้'
}

type Pending = {
  hostId: string
  summary: string
  confirmLabel: string
  mode: 'click' | 'type'
  run: () => Promise<void>
}

// Tagged with the request that produced it so a stale kind/host never shows.
type Loaded =
  | { hostId: string; kind: ResourceKind; rows: ResourceRow[]; error: null }
  | { hostId: string; kind: ResourceKind; rows: null; error: string }

export function ResourcesView({
  host,
  kind,
  containers
}: {
  host: Host
  kind: ResourceKind
  containers: ContainerInfo[]
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [filter, setFilter] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const title = TITLES[kind]

  // A confirm opened for another host must never act on this one.
  const stale = pending !== null && pending.hostId !== host.id
  if (stale) setPending(null)

  const mark = (key: string, on: boolean): void =>
    setBusy((s) => {
      const n = new Set(s)
      if (on) n.add(key)
      else n.delete(key)
      return n
    })
  // Refetch without blanking the list; also drops a row that no longer exists.
  const reload = (): void => setAttempt((n) => n + 1)
  const confirmFirst = (
    action: DangerAction,
    summary: string,
    confirmLabel: string,
    run: () => Promise<void>
  ): void => {
    const level = dangerLevel(action, host.protected)
    if (level === 'none') void run()
    else setPending({ hostId: host.id, summary, confirmLabel, mode: level, run })
  }
  const remove = (r: ResourceRow): void =>
    confirmFirst(`${kind}-rm`, `remove ${kind} · ${r.name}`, 'Remove', async () => {
      mark(`rm:${r.ref}`, true)
      try {
        await api.containers.removeResource(host.id, kind, r.ref)
        setActionError(null)
        setInfo(null)
      } catch (e) {
        setActionError(errorMessage(e))
        setInfo(null)
      } finally {
        mark(`rm:${r.ref}`, false)
        reload()
      }
    })
  const prune = (): void =>
    confirmFirst(`${kind}-prune`, PRUNE_SUMMARY[kind], 'Prune', async () => {
      const key = `prune:${kind}`
      mark(key, true)
      try {
        const res = await api.containers.prune(host.id, kind)
        setActionError(null)
        setInfo(
          `ลบแล้ว ${res.deleted} รายการ` +
            (res.reclaimed !== null ? ` · คืนพื้นที่ ${formatMem(res.reclaimed)}` : '')
        )
      } catch (e) {
        setActionError(errorMessage(e))
        setInfo(null)
      } finally {
        mark(key, false)
        reload()
      }
    })

  useEffect(() => {
    let cancelled = false
    api.containers
      .resources(host.id, kind)
      .then((rows) => {
        if (!cancelled) setLoaded({ hostId: host.id, kind, rows, error: null })
      })
      .catch((e) => {
        if (!cancelled) setLoaded({ hostId: host.id, kind, rows: null, error: errorMessage(e) })
      })
    return () => {
      cancelled = true
    }
  }, [host.id, kind, attempt])

  const current = loaded && loaded.hostId === host.id && loaded.kind === kind ? loaded : null
  if (current === null) return <div className="muted">กำลังโหลด…</div>
  if (current.error !== null) {
    return (
      <div>
        <ErrorBanner message={`โหลด ${title} บน ${host.label} ไม่ได้`} />
        <div className="error">{current.error}</div>
        <Button
          onClick={() => {
            setLoaded(null)
            setAttempt((n) => n + 1)
          }}
        >
          ลองอีกครั้ง
        </Button>
      </div>
    )
  }

  const rows = current.rows
  const needle = filter.trim().toLowerCase()
  const visible = rows.filter((r) => needle === '' || r.name.toLowerCase().includes(needle))
  return (
    <div>
      <div className="containers-toolbar">
        <TextInput
          aria-label={`Filter ${title}`}
          placeholder="Filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {actionError && <ErrorBanner message={actionError} />}
      {info && (
        <div className="muted" role="status">
          {info}
        </div>
      )}
      {rows.length === 0 && <div className="muted">{`ยังไม่มี ${kind} บน ${host.label}`}</div>}
      {rows.length > 0 && visible.length === 0 && (
        <div className="muted">ไม่มีรายการที่ตรงกับตัวกรอง</div>
      )}
      {visible.length > 0 && (
        <GroupPanel
          title={title}
          actions={
            <Button
              aria-label={`Prune ${title.toLowerCase()}`}
              disabled={busy.has(`prune:${kind}`)}
              onClick={prune}
            >
              Prune
            </Button>
          }
        >
          {visible.map((r) => (
            <ItemRow
              key={r.ref}
              actions={
                <div className="resource-actions">
                  {r.builtIn ? (
                    <span aria-hidden="true" />
                  ) : (
                    <IconButton
                      aria-label={`Remove ${r.name}`}
                      title="Remove"
                      className="container-remove"
                      disabled={busy.has(`rm:${r.ref}`)}
                      onClick={() => remove(r)}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  )}
                </div>
              }
            >
              <div className="container-title">
                <span className="container-name mono">{r.name}</span>
                {isInUse(r, containers) && <Badge tone="success">in use</Badge>}
                {r.builtIn && <Badge tone="neutral">built-in</Badge>}
              </div>
              <div className="container-metadata muted">
                {r.size !== null && <span>{formatMem(r.size)}</span>}
                {r.driver !== '' && <span>{r.driver}</span>}
                {r.created !== null && <span>{new Date(r.created).toLocaleString()}</span>}
              </div>
            </ItemRow>
          ))}
        </GroupPanel>
      )}
      {pending && !stale && (
        <ConfirmDanger
          host={host}
          summary={pending.summary}
          confirmLabel={pending.confirmLabel}
          mode={pending.mode}
          onConfirm={async () => {
            if (pending.hostId !== host.id) throw new Error('host changed')
            await pending.run()
          }}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  )
}
