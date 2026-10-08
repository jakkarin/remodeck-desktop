import { Play, RotateCw, ScrollText, Square, SquareTerminal, Trash2 } from 'lucide-react'
import type { ContainerStats } from '../../../shared/containerDetails'
import type { ContainerAction, ContainerInfo } from '../../../shared/containers'
import {
  capitalise,
  formatCpu,
  formatMem,
  isActiveContainer,
  stateTone
} from '../containerPresentation'
import { Badge, IconButton } from './ui'
import { ItemRow } from './ui/GroupedList'

export function ContainerItem({
  container: c,
  busy,
  stats,
  onAction,
  onTerminal
}: {
  container: ContainerInfo
  busy: boolean
  stats?: ContainerStats
  onAction: (action: ContainerAction) => void
  onTerminal: (kind: 'logs' | 'shell') => void
}): React.JSX.Element {
  const active = isActiveContainer(c)
  const removing = c.state === 'removing'
  const portsText = c.ports.length > 0 ? `Ports: ${c.ports.join(', ')}` : 'No ports'
  return (
    <ItemRow
      actions={
        <div className="container-actions">
          <IconButton
            aria-label={`Logs ${c.name}`}
            title="Logs"
            disabled={busy}
            onClick={() => onTerminal('logs')}
          >
            <ScrollText size={14} />
          </IconButton>
          <IconButton
            aria-label={`Shell ${c.name}`}
            title="Shell"
            disabled={busy || c.state !== 'running'}
            onClick={() => onTerminal('shell')}
          >
            <SquareTerminal size={14} />
          </IconButton>
          {active ? (
            <IconButton
              aria-label={`Stop ${c.name}`}
              title="Stop"
              disabled={busy}
              onClick={() => onAction('stop')}
            >
              <Square size={14} />
            </IconButton>
          ) : (
            <span aria-hidden="true" />
          )}
          {active ? (
            <IconButton
              aria-label={`Restart ${c.name}`}
              title="Restart"
              disabled={busy}
              onClick={() => onAction('restart')}
            >
              <RotateCw size={14} />
            </IconButton>
          ) : (
            <IconButton
              aria-label={`Start ${c.name}`}
              title="Start"
              disabled={busy || removing}
              onClick={() => onAction('start')}
            >
              <Play size={14} />
            </IconButton>
          )}
          <IconButton
            aria-label={`Remove ${c.name}`}
            title="Remove"
            className="container-remove"
            disabled={busy || removing}
            onClick={() => onAction('remove')}
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      }
    >
      <div className="container-title">
        <span className="container-name mono">{c.name}</span>
        <Badge tone={stateTone[c.state]}>{capitalise(c.state)}</Badge>
      </div>
      <div className="container-metadata muted">
        <span className="container-image mono" title={c.image}>
          {c.image}
        </span>
        <span className="container-ports" title={portsText}>
          {c.ports.length > 0 ? (
            <>
              Ports: <span>{c.ports.join(', ')}</span>
            </>
          ) : (
            'No ports'
          )}
        </span>
        <span>{c.status}</span>
        {c.state === 'running' && (
          <>
            <span className="container-cpu">CPU {stats ? formatCpu(stats.cpu) : '—'}</span>
            <span className="container-mem">RAM {stats ? formatMem(stats.memBytes) : '—'}</span>
          </>
        )}
      </div>
    </ItemRow>
  )
}
