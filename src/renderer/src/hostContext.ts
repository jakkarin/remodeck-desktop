import type { Host, Workspace } from '../../shared/types'
import { readJson, writeJson } from './storage'

const ACTIVE_HOST_KEY = 'remodeck.activeHost'
const LAST_WORKSPACE_KEY = 'remodeck.lastWorkspace'

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
