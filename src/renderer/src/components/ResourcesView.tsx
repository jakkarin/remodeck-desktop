import { useEffect, useState } from 'react'
import type { ContainerInfo } from '../../../shared/containers'
import { isInUse, type ResourceKind, type ResourceRow } from '../../../shared/resources'
import type { Host } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { formatMem } from '../containerPresentation'
import { ErrorBanner } from './ErrorBanner'
import { Badge, Button, TextInput } from './ui'
import { GroupPanel, ItemRow } from './ui/GroupedList'

const TITLES: Record<ResourceKind, string> = {
  image: 'Images',
  volume: 'Volumes',
  network: 'Networks'
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
  const title = TITLES[kind]

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
      {rows.length === 0 && <div className="muted">{`ยังไม่มี ${kind} บน ${host.label}`}</div>}
      {rows.length > 0 && visible.length === 0 && (
        <div className="muted">ไม่มีรายการที่ตรงกับตัวกรอง</div>
      )}
      <GroupPanel title={title}>
        {visible.map((r) => (
          <ItemRow key={`${r.ref}`} actions={null}>
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
    </div>
  )
}
