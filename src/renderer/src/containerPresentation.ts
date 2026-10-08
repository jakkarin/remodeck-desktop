import type { ContainerInfo, ContainerState } from '../../shared/containers'
import type { BadgeTone } from './components/ui'

export const isActiveContainer = (c: ContainerInfo): boolean =>
  c.state === 'running' || c.state === 'restarting' || c.state === 'paused'

export const stateTone: Record<ContainerState, BadgeTone> = {
  running: 'success',
  paused: 'warning',
  restarting: 'warning',
  dead: 'danger',
  created: 'neutral',
  removing: 'neutral',
  exited: 'neutral'
}

export const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
