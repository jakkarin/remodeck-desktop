export type DangerAction =
  | 'start'
  | 'logs'
  | 'shell'
  | 'inspect'
  | 'stop'
  | 'restart'
  | 'compose-up'
  | 'compose-pull'
  | 'compose-restart'
  | 'remove'
  | 'compose-down'
  | 'image-rm'
  | 'image-prune'
  | 'network-rm'
  | 'network-prune'
  | 'volume-rm'
  | 'volume-prune'

export type DangerLevel = 'none' | 'click' | 'type'

const SAFE: ReadonlySet<DangerAction> = new Set(['start', 'logs', 'shell', 'inspect'])
const DISRUPTIVE: ReadonlySet<DangerAction> = new Set([
  'stop',
  'restart',
  'compose-up',
  'compose-pull',
  'compose-restart'
])
const DATA_LOSS: ReadonlySet<DangerAction> = new Set(['volume-rm', 'volume-prune'])

/** Confirmation required for an action, per the danger table. Protected hosts escalate one step. */
export function dangerLevel(action: DangerAction, isProtected: boolean): DangerLevel {
  if (SAFE.has(action)) return 'none'
  if (DISRUPTIVE.has(action)) return isProtected ? 'click' : 'none'
  if (DATA_LOSS.has(action)) return 'type'
  return isProtected ? 'type' : 'click'
}
