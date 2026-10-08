import { Play, RotateCw, Square, Trash2 } from 'lucide-react'
import type { ContainerAction, ContainerInfo } from '../../../shared/containers'
import { capitalise, isActiveContainer, stateTone } from '../containerPresentation'
import { Badge, IconButton } from './ui'
import { ItemRow } from './ui/GroupedList'

export function ContainerItem({
  container: c,
  busy,
  onAction
}: {
  container: ContainerInfo
  busy: boolean
  onAction: (action: ContainerAction) => void
}): React.JSX.Element {
  const active = isActiveContainer(c)
  const removing = c.state === 'removing'
  const portsText = c.ports.length > 0 ? `Ports: ${c.ports.join(', ')}` : 'No ports'
  return (
    <ItemRow
      actions={
        <div className="container-actions">
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
      </div>
    </ItemRow>
  )
}
