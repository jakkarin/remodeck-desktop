import { useState } from 'react'
import type { ContainerAction, ContainerInfo } from '../../../shared/containers'
import { groupContainers } from '../../../shared/containers'
import type { Host } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { capitalise, isActiveContainer } from '../containerPresentation'
import { dangerLevel } from '../danger'
import { readJson, writeJson } from '../storage'
import { useContainers } from '../useContainers'
import { ConfirmDanger } from './ConfirmDanger'
import { ErrorBanner } from './ErrorBanner'
import { Badge, Button, TextInput } from './ui'
import { GroupPanel } from './ui/GroupedList'
import { ContainerItem } from './ContainerItem'

const COLLAPSED_KEY = 'remodeck.composeCollapsed'

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
      (showStopped || isActiveContainer(c)) &&
      (needle === '' ||
        c.name.toLowerCase().includes(needle) ||
        c.image.toLowerCase().includes(needle))
  )
  const { projects, standalone } = groupContainers(visible)

  const row = (c: ContainerInfo): React.JSX.Element => (
    <ContainerItem
      key={c.id}
      container={c}
      busy={busy.has(c.id)}
      onAction={(action) => request(c, action)}
    />
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
      {projects.map((p) => (
        <GroupPanel
          key={p.name}
          title={`${p.name} (compose)`}
          collapsed={collapsed.includes(p.name)}
          onToggle={() => toggleProject(p.name)}
        >
          {p.containers.map(row)}
        </GroupPanel>
      ))}
      {standalone.length > 0 && <GroupPanel title="Standalone">{standalone.map(row)}</GroupPanel>}
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
