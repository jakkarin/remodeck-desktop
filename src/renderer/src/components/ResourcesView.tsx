import { useEffect, useId, useState } from 'react'
import type { ContainerInfo } from '../../../shared/containers'
import { isInUse, type ResourceKind, type ResourceRow } from '../../../shared/resources'
import type { Host } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { Trash2 } from 'lucide-react'
import { cn } from 'cn'
import { formatMem } from '../containerPresentation'
import { dangerLevel, type DangerAction } from '../danger'
import { useHostCommandTerminal } from '../useHostCommandTerminal'
import { ConfirmDanger } from './ConfirmDanger'
import { Banner } from './Banner'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'

const TITLES: Record<ResourceKind, string> = {
  image: 'Images',
  volume: 'Volumes',
  network: 'Networks'
}

const NAME_HEADING: Record<ResourceKind, string> = {
  image: 'Repository : tag',
  volume: 'Name',
  network: 'Name'
}

const PRUNE_SUMMARY: Record<ResourceKind, string> = {
  image: 'prune images — removes only untagged (dangling) images',
  volume:
    'prune volumes — removes volumes no container uses (Docker ≥ 23 removes only anonymous volumes)',
  network: 'prune networks — removes networks no container uses'
}

/** Shared column template for the header row and every resource row. */
const RESOURCE_GRID =
  'grid grid-cols-[minmax(180px,1.6fr)_minmax(100px,0.8fr)_minmax(120px,1fr)_minmax(80px,0.6fr)_28px] items-center gap-2.5'

const DASH = '—'

/** Untagged images carry their image id as ref (see toImageRows in shared/resources.ts). */
const isDangling = (r: ResourceRow): boolean => r.kind === 'image' && r.ref === r.id

/** Volumes have no id distinct from their name, so the ID column shows a dash for them. */
const shortId = (r: ResourceRow): string =>
  r.kind === 'volume' ? DASH : r.id.replace(/^sha256:/, '').slice(0, 12)

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
  const titleId = useId()
  const title = TITLES[kind]
  // Reload once the prune terminal exits; switching host or kind abandons it.
  const pruneTerminal = useHostCommandTerminal(`${host.id}:${kind}`, () => setAttempt((n) => n + 1))

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
      } catch (e) {
        setActionError(errorMessage(e))
      } finally {
        mark(`rm:${r.ref}`, false)
        reload()
      }
    })
  const prune = (): void =>
    confirmFirst(`${kind}-prune`, PRUNE_SUMMARY[kind], 'Prune', async () => {
      await pruneTerminal.run(host.id, { kind: 'resource-prune', resource: kind })
      setActionError(null)
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
  if (current === null) return <div className="text-muted-foreground">Loading…</div>
  if (current.error !== null) {
    return (
      <div>
        <Banner tone="danger">{`Cannot load ${title} on ${host.label}`}</Banner>
        <div className="my-2 text-xs text-destructive">{current.error}</div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoaded(null)
            setAttempt((n) => n + 1)
          }}
        >
          Try again
        </Button>
      </div>
    )
  }

  const rows = current.rows
  const needle = filter.trim().toLowerCase()
  const visible = rows.filter((r) => needle === '' || r.name.toLowerCase().includes(needle))
  return (
    <TooltipProvider>
      <div>
        <div className="flex flex-wrap items-center gap-3 pb-3">
          <Input
            aria-label={`Filter ${title}`}
            placeholder="Filter"
            className="w-[240px]"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {actionError && <Banner tone="danger">{actionError}</Banner>}
        {rows.length === 0 && (
          <div className="px-3.5 py-3 text-muted-foreground">{`No ${kind}s on ${host.label}`}</div>
        )}
        {rows.length > 0 && visible.length === 0 && (
          <div className="px-3.5 py-3 text-muted-foreground">Nothing matches the filter</div>
        )}
        {visible.length > 0 && (
          <section aria-labelledby={titleId} className="pb-2">
            <h3 className="m-0 flex flex-wrap items-center gap-2.5 px-3.5 pt-1 pb-1.5 text-[13px]">
              <span id={titleId} className="font-semibold">
                {title}
              </span>
              <span className="ml-auto flex gap-1 font-normal">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Prune ${title.toLowerCase()}`}
                  className="text-destructive"
                  disabled={pruneTerminal.running}
                  onClick={prune}
                >
                  Prune
                </Button>
              </span>
            </h3>
            <div className="overflow-x-auto">
              <div className="flex min-w-[640px] flex-col px-1.5">
                <div
                  aria-hidden="true"
                  className={cn(
                    RESOURCE_GRID,
                    'px-2 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'
                  )}
                >
                  <span>{NAME_HEADING[kind]}</span>
                  <span>ID</span>
                  <span>Created</span>
                  <span>Size</span>
                  <span />
                </div>
                <ul className="m-0 flex list-none flex-col p-0">
                  {visible.map((r) => (
                    <li
                      key={r.ref}
                      className={cn(
                        RESOURCE_GRID,
                        'rounded-[7px] px-2 py-1.5 transition-colors hover:bg-accent'
                      )}
                    >
                      <div className="flex min-w-0 flex-col">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span
                            className="mono truncate font-mono text-xs font-medium"
                            title={r.name}
                          >
                            {r.name}
                          </span>
                          {isInUse(r, containers) && <Badge variant="success">in use</Badge>}
                          {isDangling(r) && <Badge variant="secondary">dangling</Badge>}
                          {r.builtIn && <Badge variant="secondary">built-in</Badge>}
                        </div>
                        {r.driver !== '' && (
                          <div className="truncate text-[11px] text-muted-foreground">
                            {r.driver}
                          </div>
                        )}
                      </div>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {shortId(r)}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {r.created !== null ? new Date(r.created).toLocaleString() : DASH}
                      </span>
                      <span className="font-mono text-xs">
                        {r.size !== null ? formatMem(r.size) : DASH}
                      </span>
                      <div className="flex justify-end">
                        {r.builtIn ? (
                          <span aria-hidden="true" className="size-7" />
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove ${r.name}`}
                                className="text-muted-foreground hover:text-destructive"
                                disabled={busy.has(`rm:${r.ref}`)}
                                onClick={() => remove(r)}
                              >
                                <Trash2 />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Remove</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
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
    </TooltipProvider>
  )
}
