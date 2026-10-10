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

export const formatCpu = (n: number): string => `${n.toFixed(1)}%`

export const formatMem = (bytes: number): string => {
  const mb = Math.round(bytes / 1048576)
  return mb < 1024 ? `${mb} MB` : `${(bytes / 1073741824).toFixed(1)} GB`
}

/** States moving toward another state; the status dot pulses for these only. */
export const isTransitional = (s: ContainerState): boolean => s === 'restarting' || s === 'removing'
