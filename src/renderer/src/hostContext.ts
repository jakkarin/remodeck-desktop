import type { Host, Workspace } from '../../shared/types'
import { readJson, writeJson } from './storage'

const ACTIVE_HOST_KEY = 'remodeck.activeHost'
const LAST_WORKSPACE_KEY = 'remodeck.lastWorkspace'
const ACTIVE_MODULE_KEY = 'remodeck.activeModule'

export type Module = 'git' | 'containers' | 'settings'

export function readActiveModule(): 'git' | 'containers' {
  const v = readJson<unknown>(ACTIVE_MODULE_KEY, 'git')
  return v === 'containers' ? 'containers' : 'git'
}

/** Settings is a transient page: it is never persisted, so a restart returns to the last real module. */
export function saveActiveModule(m: Module): void {
  if (m === 'settings') return
  writeJson(ACTIVE_MODULE_KEY, m)
}

export function readActiveHost(): string | null {
  return readJson<string | null>(ACTIVE_HOST_KEY, null)
}

export function saveActiveHost(id: string | null): void {
  writeJson(ACTIVE_HOST_KEY, id)
}

export function readLastWorkspaces(): Record<string, string> {
  return readJson<Record<string, string>>(LAST_WORKSPACE_KEY, {})
}

export function saveLastWorkspace(hostId: string, wsId: string): void {
  writeJson(LAST_WORKSPACE_KEY, { ...readLastWorkspaces(), [hostId]: wsId })
}

/** The preferred host when it still exists, else the first host, else null. */
export function pickHost(hosts: Host[], preferred: string | null): string | null {
  if (preferred !== null && hosts.some((h) => h.id === preferred)) return preferred
  return hosts[0]?.id ?? null
}

/** The host's remembered workspace when it still belongs to it, else its first one, else null. */
export function pickWorkspace(
  hostId: string | null,
  workspaces: Workspace[],
  last: Record<string, string>
): string | null {
  if (hostId === null) return null
  const own = workspaces.filter((x) => x.hostId === hostId)
  const remembered = last[hostId]
  if (remembered && own.some((x) => x.id === remembered)) return remembered
  return own[0]?.id ?? null
}
