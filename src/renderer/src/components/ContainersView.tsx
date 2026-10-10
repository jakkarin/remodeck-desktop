import { useRef, useState } from 'react'
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
import { startDragResize } from '../dragResize'
import { openHostTerminal } from '../terminalEvents'
import { useContainers } from '../useContainers'
import { useContainerStats } from '../useContainerStats'
import { ConfirmDanger } from './ConfirmDanger'
import { Banner } from './Banner'
import { cn } from 'cn'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'
import { TooltipProvider } from './ui/tooltip'
import { ContainerGroup } from './ContainerGroup'
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

const CARD =
  'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background'
const TOOLBAR = 'flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-3 py-2.5'

const COLLAPSED_KEY = 'remodeck.composeCollapsed'
const DETAILS_WIDTH_KEY = 'remodeck.containerDetailsWidth'
const DETAILS_MIN = 280
const DETAILS_DEFAULT = 400
// Room the container list keeps when the details panel is dragged wider.
const LIST_MIN = 320

function readDetailsWidth(): number {
  const v = readJson<unknown>(DETAILS_WIDTH_KEY, null)
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(DETAILS_MIN, v) : DETAILS_DEFAULT
}

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
const NO_PATH_HINT = 'Compose project path unknown (see the terminal for actual results)'

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
  const [detailsWidth, setDetailsWidth] = useState(readDetailsWidth)
  const splitRef = useRef<HTMLDivElement>(null)

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

  // The resource tabs need the host the failed list left disposed.
  if (error !== null && tab !== 'containers') setTab('containers')
  const tabStrip = (
    <div role="tablist" aria-label="Docker resources" className="flex rounded-lg bg-muted p-0.5">
      {TABS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          className={cn(
            'h-6.5 rounded-md px-2.5 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50',
            tab === id && 'bg-background font-medium text-foreground shadow-xs'
          )}
          disabled={error !== null && id !== 'containers'}
          title={
            error !== null && id !== 'containers'
              ? 'Failed to load containers — press Retry first'
              : undefined
          }
          onClick={() => setTab(id)}
        >
          {label}
        </button>
      ))}
    </div>
  )
  // One tree for every state so the tab strip keeps its identity while switching tabs.
  const frame = (
    body: React.ReactNode,
    extras?: React.ReactNode,
    details?: React.ReactNode,
    after?: React.ReactNode
  ): React.JSX.Element => (
    <TooltipProvider>
      <div className="@container h-full min-h-0 p-2">
        <div
          ref={splitRef}
          className={cn(
            'containers-split grid h-full min-h-0 grid-cols-[minmax(0,1fr)]',
            details &&
              'grid-cols-[minmax(0,1fr)_6px_min(var(--details-width,400px),max(280px,calc(100%-320px)))] @max-[720px]:grid-cols-[minmax(0,1fr)] @max-[720px]:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]'
          )}
          style={{ '--details-width': `${detailsWidth}px` } as React.CSSProperties}
        >
          <div className={CARD}>
            <div className={TOOLBAR}>
              {tabStrip}
              {extras}
            </div>
            {body}
          </div>
          {details}
        </div>
      </div>
      {after}
    </TooltipProvider>
  )
  const padded = (children: React.ReactNode): React.JSX.Element => (
    <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
  )
  if (tab !== 'containers') {
    return frame(padded(<ResourcesView key={tab} host={host} kind={tab} containers={list ?? []} />))
  }

  if (error !== null) {
    return frame(
      padded(
        <div className="flex flex-col items-start gap-3">
          <Banner tone="danger">{`Cannot connect to docker on ${host.label}`}</Banner>
          <div className="text-destructive">{error}</div>
          <Button variant="outline" onClick={retry}>
            Retry
          </Button>
        </div>
      )
    )
  }
  if (list === null) {
    return frame(padded(<div className="text-muted-foreground">Loading…</div>))
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
  const resizeDetails = (e: React.PointerEvent<HTMLDivElement>): void => {
    // A 0 width (no layout, e.g. jsdom) means no maximum.
    const w = splitRef.current?.getBoundingClientRect().width ?? 0
    startDragResize(e, {
      axis: 'x',
      start: detailsWidth,
      min: DETAILS_MIN,
      max: w > 0 ? Math.max(DETAILS_MIN, w - LIST_MIN) : Infinity,
      invert: true,
      onChange: setDetailsWidth,
      onEnd: (width) => writeJson(DETAILS_WIDTH_KEY, width)
    })
  }
  const runningIn = (name: string): string => {
    const all = list.filter((c) => c.compose?.project === name)
    return `compose · ${all.filter((c) => c.state === 'running').length} of ${all.length} running`
  }
  return frame(
    <div className="min-h-0 flex-1 overflow-auto">
      {actionError && <Banner tone="danger">{actionError}</Banner>}
      {list.length === 0 && (
        <div className="p-3.5 text-muted-foreground">{`No containers on ${host.label}`}</div>
      )}
      {list.length > 0 && visible.length === 0 && (
        <div className="p-3.5 text-muted-foreground">No containers match the filter</div>
      )}
      {projects.map((p) => (
        <ContainerGroup
          key={p.name}
          title={`${p.name} (compose)`}
          meta={runningIn(p.name)}
          collapsed={collapsed.includes(p.name)}
          onToggle={() => toggleProject(p.name)}
          titleHint={projectHint(p)}
          actions={COMPOSE_LABELS.map(([action, label]) => (
            <Button
              key={action}
              variant="outline"
              size="sm"
              aria-label={`${label} ${p.name}`}
              className={cn(action === 'down' && 'border-destructive/30 text-destructive')}
              disabled={busy.has(`compose:${p.name}`)}
              onClick={() => compose(p.name, action)}
            >
              {label}
            </Button>
          ))}
        >
          {p.containers.map(row)}
        </ContainerGroup>
      ))}
      {standalone.length > 0 && (
        <ContainerGroup
          title="Standalone"
          meta={`${standalone.length} ${standalone.length === 1 ? 'container' : 'containers'}`}
        >
          {standalone.map(row)}
        </ContainerGroup>
      )}
    </div>,
    <>
      <div className="flex-1" />
      {!live && <Badge variant="warning">Live updates paused</Badge>}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={showStopped} onCheckedChange={(v) => setShowStopped(v === true)} />
        Show stopped
      </label>
      <Input
        aria-label="Filter containers"
        placeholder="Filter"
        className="h-7 w-48"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
    </>,
    selected && (
      <>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize details"
          className="cursor-col-resize touch-none rounded-full transition-colors hover:bg-(--accent)/40 @max-[720px]:hidden"
          onPointerDown={resizeDetails}
        />
        <ContainerDetailsPanel
          key={selected.id}
          host={host}
          container={selected}
          onClose={() => setSelectedId(null)}
        />
      </>
    ),
    pending && !stale && (
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
    )
  )
}
