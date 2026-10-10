import { Play, RotateCw, ScrollText, Square, SquareTerminal, Trash2 } from 'lucide-react'
import { cn } from 'cn'
import type { ContainerStats } from '../../../shared/containerDetails'
import type { ContainerAction, ContainerInfo } from '../../../shared/containers'
import {
  capitalise,
  formatCpu,
  formatMem,
  isActiveContainer,
  isTransitional
} from '../containerPresentation'
import { CONTAINER_GRID } from './ContainerGroup'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

const DASH = '—'

/** Icon button whose label is also shown as a tooltip; the aria-label stays the accessible name. */
function RowAction({
  label,
  name,
  icon,
  disabled,
  danger,
  onClick
}: {
  label: string
  name: string
  icon: React.ReactNode
  disabled: boolean
  danger?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${label} ${name}`}
          disabled={disabled}
          className={cn('text-muted-foreground', danger && 'hover:text-destructive')}
          onClick={onClick}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

const dotTone: Record<ContainerInfo['state'], string> = {
  running: 'bg-success shadow-[0_0_0_3px_var(--success-bg)]',
  paused: 'bg-warning',
  restarting: 'bg-warning',
  removing: 'bg-muted-foreground',
  dead: 'bg-destructive',
  created: 'border-[1.5px] border-muted-foreground',
  exited: 'border-[1.5px] border-muted-foreground'
}

export function ContainerItem({
  container: c,
  busy,
  stats,
  selected,
  onSelect,
  onAction,
  onTerminal
}: {
  container: ContainerInfo
  busy: boolean
  stats?: ContainerStats
  selected: boolean
  onSelect: () => void
  onAction: (action: ContainerAction) => void
  onTerminal: (kind: 'logs' | 'shell') => void
}): React.JSX.Element {
  const active = isActiveContainer(c)
  const removing = c.state === 'removing'
  const running = c.state === 'running'
  const pulse = isTransitional(c.state)
  const portsText = c.ports.length > 0 ? c.ports.join(', ') : null
  const cpu = running && stats && stats.cpu !== null ? formatCpu(stats.cpu) : DASH
  const mem = running && stats ? formatMem(stats.memBytes) : DASH
  const mono = 'font-mono text-xs'
  return (
    <li
      className={cn(
        CONTAINER_GRID,
        'rounded-[7px] px-2 py-1.5 transition-colors hover:bg-accent',
        selected && 'bg-selected text-selected-foreground hover:bg-selected',
        !active && !selected && 'text-muted-foreground'
      )}
    >
      <span
        data-pulse={pulse ? 'true' : undefined}
        className={cn('size-2 rounded-full', dotTone[c.state], pulse && 'animate-pulse')}
      >
        <span className="sr-only">{capitalise(c.state)}</span>
      </span>
      <div className="min-w-0">
        <button
          type="button"
          className="block max-w-full truncate rounded-sm text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          aria-label={`Details for ${c.name}`}
          aria-pressed={selected}
          title={c.name}
          onClick={onSelect}
        >
          {c.name}
        </button>
        <div className="truncate text-[11px] text-muted-foreground">{c.status}</div>
      </div>
      <span className={cn(mono, 'truncate')} title={c.image}>
        {c.image}
      </span>
      <span className={cn(mono, 'truncate')} title={portsText ?? 'No ports'}>
        {portsText ? (
          portsText
        ) : (
          <>
            <span className="sr-only">No ports</span>
            <span aria-hidden="true">{DASH}</span>
          </>
        )}
      </span>
      <span className={mono}>
        {running && <span className="sr-only">{`CPU ${cpu}`}</span>}
        <span aria-hidden={running ? 'true' : undefined}>{cpu}</span>
      </span>
      <span className={mono}>
        {running && <span className="sr-only">{`RAM ${mem}`}</span>}
        <span aria-hidden={running ? 'true' : undefined}>{mem}</span>
      </span>
      <div className="flex justify-end gap-0.5">
        <RowAction
          label="Logs"
          name={c.name}
          icon={<ScrollText />}
          disabled={busy}
          onClick={() => onTerminal('logs')}
        />
        <RowAction
          label="Shell"
          name={c.name}
          icon={<SquareTerminal />}
          disabled={busy || !running}
          onClick={() => onTerminal('shell')}
        />
        {active ? (
          <RowAction
            label="Stop"
            name={c.name}
            icon={<Square />}
            disabled={busy}
            onClick={() => onAction('stop')}
          />
        ) : (
          <span aria-hidden="true" className="size-7" />
        )}
        {active ? (
          <RowAction
            label="Restart"
            name={c.name}
            icon={<RotateCw />}
            disabled={busy}
            onClick={() => onAction('restart')}
          />
        ) : (
          <RowAction
            label="Start"
            name={c.name}
            icon={<Play />}
            disabled={busy || removing}
            onClick={() => onAction('start')}
          />
        )}
        <RowAction
          label="Remove"
          name={c.name}
          icon={<Trash2 />}
          danger
          disabled={busy || removing}
          onClick={() => onAction('remove')}
        />
      </div>
    </li>
  )
}
