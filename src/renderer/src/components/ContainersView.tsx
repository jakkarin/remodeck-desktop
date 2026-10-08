import { useState } from 'react'
import type {
  ComposeAction,
  ContainerAction,
  ContainerInfo,
  ContainerProject,
  HostTerminalRequest
} from '../../../shared/containers'
import { groupContainers } from '../../../shared/containers'
import type { Host } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { capitalise, isActiveContainer } from '../containerPresentation'
import { dangerLevel } from '../danger'
import { readJson, writeJson } from '../storage'
import { openHostTerminal } from '../terminalEvents'
import { useContainers } from '../useContainers'
import { useContainerStats } from '../useContainerStats'
import { ConfirmDanger } from './ConfirmDanger'
import { ErrorBanner } from './ErrorBanner'
import { Badge, Button, TextInput } from './ui'
import { GroupPanel } from './ui/GroupedList'
import { ContainerItem } from './ContainerItem'
import { ContainerDetailsPanel } from './ContainerDetailsPanel'
import { ResourcesView } from './ResourcesView'
import type { ResourceKind } from '../../../shared/resources'

type Tab = 'containers' | ResourceKind
const TABS: [Tab, string][] = [
  ['containers', 'Containers'],
  ['image', 'Images'],
  ['volume', 'Volumes'],
  ['network', 'Networks']
]

const COLLAPSED_KEY = 'remodeck.composeCollapsed'

type Pending = {
  hostId: string
  summary: string
  confirmLabel: string
  mode: 'click' | 'type'
  run: () => Promise<void>
}

const COMPOSE_LABELS: [ComposeAction, string][] = [
  ['up', 'Up'],
  ['pull', 'Pull'],
  ['restart', 'Restart'],
  ['down', 'Down']
]
const NO_PATH_HINT = 'ไม่พบ path ของ compose project (ผลจริงดูใน terminal)'

function projectHint(p: ContainerProject): string {
  return p.workingDir && p.configFiles.length > 0
    ? `${p.workingDir} · ${p.configFiles.join(', ')}`
    : NO_PATH_HINT
}

export function ContainersView({ host }: { host: Host }): React.JSX.Element {
  const { list, live, error, retry } = useContainers(host.id)
  const [tab, setTab] = useState<Tab>('containers')
  const stats = useContainerStats(host.id, list !== null && tab === 'containers')
  const [filter, setFilter] = useState('')
  const [showStopped, setShowStopped] = useState(false)
  const [collapsedAll, setCollapsedAll] = useState<Record<string, string[]>>(() =>
    readJson<Record<string, string[]>>(COLLAPSED_KEY, {})
  )
  const [actionError, setActionError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
  const mark = (id: string, on: boolean): void =>
    setBusy((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })
  const request = (c: ContainerInfo, action: ContainerAction): void => {
    const level = dangerLevel(action, host.protected)
    if (level === 'none') {
      mark(c.id, true)
      run(c, action)
        .catch((e) => setActionError(errorMessage(e)))
        .finally(() => mark(c.id, false))
    } else {
      setPending({
        hostId: host.id,
        summary: `${action} · ${c.name}`,
        confirmLabel: capitalise(action),
        mode: level,
        run: () => run(c, action)
      })
    }
  }
  const openTerminal = async (req: HostTerminalRequest): Promise<void> => {
    await openHostTerminal(host.id, req)
    setActionError(null)
  }
  // Hold `key` busy until the terminal request settles so a double click opens one tab.
  const guarded = (key: string, fn: () => Promise<void>): Promise<void> => {
    mark(key, true)
    return fn().finally(() => mark(key, false))
  }
  const gate = (
    level: ReturnType<typeof dangerLevel>,
    summary: string,
    confirmLabel: string,
    key: string,
    req: HostTerminalRequest
  ): void => {
    const go = (): Promise<void> => guarded(key, () => openTerminal(req))
    if (level === 'none') {
      go().catch((e) => setActionError(errorMessage(e)))
    } else {
      setPending({ hostId: host.id, summary, confirmLabel, mode: level, run: go })
    }
  }
  const terminal = (c: ContainerInfo, kind: 'logs' | 'shell'): void =>
    gate(dangerLevel(kind, host.protected), `${kind} · ${c.name}`, capitalise(kind), c.id, {
      kind,
      id: c.id
    })
  const compose = (project: string, action: ComposeAction): void =>
    gate(
      dangerLevel(`compose-${action}`, host.protected),
      `${action} · ${project}`,
      capitalise(action),
      `compose:${project}`,
      { kind: 'compose', project, action }
    )

  const tabStrip = (
    <div role="tablist" aria-label="Docker resources" className="details-tabs">
      {TABS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          className="details-tab"
          onClick={() => setTab(id)}
        >
          {label}
        </button>
      ))}
    </div>
  )
  if (tab !== 'containers') {
    return (
      <div className="containers-view">
        {tabStrip}
        <ResourcesView key={tab} host={host} kind={tab} containers={list ?? []} />
      </div>
    )
  }

  if (error !== null) {
    return (
      <div className="containers-view">
        {tabStrip}
        <ErrorBanner message={`เชื่อมต่อ docker บน ${host.label} ไม่ได้`} />
        <div className="error">{error}</div>
        <Button onClick={retry}>Retry</Button>
      </div>
    )
  }
  if (list === null) {
    return (
      <div className="containers-view">
        {tabStrip}
        <div className="muted">กำลังโหลด…</div>
      </div>
    )
  }

  const selected = selectedId === null ? undefined : list.find((c) => c.id === selectedId)
  // The selected container left the list: close its panel.
  if (selectedId !== null && !selected) setSelectedId(null)

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
      stats={stats[c.id]}
      selected={selectedId === c.id}
      onSelect={() => setSelectedId((cur) => (cur === c.id ? null : c.id))}
      onAction={(action) => request(c, action)}
      onTerminal={(kind) => terminal(c, kind)}
    />
  )
  return (
    <div className="containers-view">
      {tabStrip}
      <div className={`containers-split${selected ? ' has-details' : ''}`}>
        <div className="containers-main">
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
          {list.length === 0 && (
            <div className="muted">{`ยังไม่มี container บน ${host.label}`}</div>
          )}
          {list.length > 0 && visible.length === 0 && (
            <div className="muted">ไม่มี container ที่ตรงกับตัวกรอง</div>
          )}
          {projects.map((p) => (
            <GroupPanel
              key={p.name}
              title={`${p.name} (compose)`}
              collapsed={collapsed.includes(p.name)}
              onToggle={() => toggleProject(p.name)}
              titleHint={projectHint(p)}
              actions={COMPOSE_LABELS.map(([action, label]) => (
                <Button
                  key={action}
                  aria-label={`${label} ${p.name}`}
                  disabled={busy.has(`compose:${p.name}`)}
                  onClick={() => compose(p.name, action)}
                >
                  {label}
                </Button>
              ))}
            >
              {p.containers.map(row)}
            </GroupPanel>
          ))}
          {standalone.length > 0 && (
            <GroupPanel title="Standalone">{standalone.map(row)}</GroupPanel>
          )}
        </div>
        {selected && (
          <ContainerDetailsPanel
            key={selected.id}
            host={host}
            container={selected}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
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
