import type { ContainerInfo, ContainerState } from '../../shared/containers'

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger'

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

const UNITS: [RegExp, string][] = [
  [/^less than a second$/i, '<1s'],
  [/^about a minute$/i, '1m'],
  [/^about an hour$/i, '1h'],
  [/^(\d+) seconds?$/i, 's'],
  [/^(\d+) minutes?$/i, 'm'],
  [/^(\d+) hours?$/i, 'h'],
  [/^(\d+) days?$/i, 'd'],
  [/^(\d+) weeks?$/i, 'w'],
  [/^(\d+) months?$/i, 'mo'],
  [/^(\d+) years?$/i, 'y']
]

/** Docker's "Up 9 hours (healthy)" as "9h"; "Exited (1) 2 days ago" as "Exited (1)"; else the state. */
export function shortStatus(c: ContainerInfo): string {
  const up = /^Up (.+?)(?: \(.*\))?$/.exec(c.status)
  if (c.state === 'running' && up) {
    for (const [re, unit] of UNITS) {
      const m = re.exec(up[1])
      if (m) return m[1] ? `${m[1]}${unit}` : unit
    }
    return up[1]
  }
  const exited = /^Exited \((\d+)\)/.exec(c.status)
  if (exited) return `Exited (${exited[1]})`
  return capitalise(c.state)
}

/** Text tone for `shortStatus`: a non-zero exit is an error, restarts and pauses are warnings. */
export function statusTone(c: ContainerInfo): BadgeTone {
  if (c.state === 'exited') return /^Exited \(0\)/.test(c.status) ? 'neutral' : 'danger'
  return c.state === 'running' ? 'neutral' : stateTone[c.state]
}
