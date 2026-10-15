import { useEffect, useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import type { BuildRecord } from '../../../shared/builds'
import type { Host } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { dangerLevel } from '../danger'
import { openHostTerminal } from '../terminalEvents'
import { Banner } from './Banner'
import { ConfirmDanger } from './ConfirmDanger'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

type Loaded = { attempt: number; rows: BuildRecord[] | null; error: string | null }

function duration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function BuildsView({ host }: { host: Host }): React.JSX.Element {
  // Reset rows, result, and confirmation together when switching hosts.
  return <HostBuildsView key={host.id} host={host} />
}

function HostBuildsView({ host }: { host: Host }): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [pending, setPending] = useState(false)
  const [pruning, setPruning] = useState(false)
  const loading = loaded === null || loaded.attempt !== attempt

  useEffect(() => {
    let cancelled = false
    api.containers
      .buildHistory(host.id)
      .then((rows) => {
        if (!cancelled) setLoaded({ attempt, rows, error: null })
      })
      .catch((e) => {
        if (!cancelled) setLoaded({ attempt, rows: null, error: errorMessage(e) })
      })
    return () => {
      cancelled = true
    }
  }, [host.id, attempt])

  const prune = async (): Promise<void> => {
    setPruning(true)
    try {
      await openHostTerminal(host.id, { kind: 'build-cache-prune' })
    } finally {
      setPruning(false)
    }
  }
  const rows = loaded?.rows ?? []
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 flex-1 text-xs text-muted-foreground">
          Builds from the current builder on {host.label}
        </p>
        <Button
          variant="outline"
          size="sm"
          aria-label="Refresh builds"
          disabled={loading || pruning}
          onClick={() => setAttempt((n) => n + 1)}
        >
          <RefreshCw data-icon="inline-start" /> Refresh
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={loading || pruning}
          onClick={() => setPending(true)}
        >
          <Trash2 data-icon="inline-start" /> Prune build cache
        </Button>
      </div>
      {loaded?.error && <Banner tone="danger">{loaded.error}</Banner>}
      {loading && <div className="text-muted-foreground">Loading builds…</div>}
      {!loading && loaded?.error === null && rows.length === 0 && (
        <div className="text-muted-foreground">No builds on {host.label}</div>
      )}
      {rows.length > 0 && (
        <Table aria-label="Build history">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Build ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.ref}>
                <TableCell>
                  <span className="block max-w-80 truncate" title={r.name}>
                    {r.name}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="font-mono" title={r.ref}>
                    {r.ref.split('/').at(-1)}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      r.status === 'Completed'
                        ? 'success'
                        : r.status === 'Error'
                          ? 'destructive'
                          : r.status === 'Running'
                            ? 'warning'
                            : 'secondary'
                    }
                  >
                    {r.status}
                  </Badge>
                </TableCell>
                <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                <TableCell>{duration(r.durationMs)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {pending && (
        <ConfirmDanger
          host={host}
          summary="Open a terminal to prune unused build cache from this host’s current builder. Future builds may take longer while the cache is rebuilt."
          confirmLabel="Prune"
          mode={dangerLevel('build-cache-prune', host.protected) === 'type' ? 'type' : 'click'}
          onConfirm={prune}
          onClose={() => setPending(false)}
        />
      )}
    </div>
  )
}
