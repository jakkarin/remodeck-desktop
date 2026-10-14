import { api } from './api'
import type { HostTerminalRequest } from '../../shared/containers'

export type OpenedTab = { tabId: string; label: string; hostId: string }

const listeners = new Set<(tab: OpenedTab) => void>()
const closeListeners = new Set<(tabId: string) => void>()

/** Notifies TerminalTabs that a terminal was opened so its tab appears and is focused. */
export function announceTerminal(tab: OpenedTab): void {
  for (const l of listeners) l(tab)
}

export function onTerminalOpened(cb: (tab: OpenedTab) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Renderer-initiated close does not produce terminal-exit from main. */
export function closeTerminal(tabId: string): void {
  api.terminal.close(tabId)
  for (const listener of closeListeners) listener(tabId)
}

export function onTerminalClosed(cb: (tabId: string) => void): () => void {
  closeListeners.add(cb)
  return () => {
    closeListeners.delete(cb)
  }
}

/** Opens a terminal for the workspace; TerminalTabs shows the new tab via the announce event. */
export async function openTerminal(workspaceId: string, path?: string): Promise<unknown> {
  const tab = await api.terminal.open(workspaceId, path)
  if (tab && typeof tab === 'object' && 'tabId' in tab) announceTerminal(tab)
  return tab
}

/** Opens a host-bound command terminal and announces its tab. */
export async function openHostTerminal(
  hostId: string,
  req: HostTerminalRequest
): Promise<OpenedTab> {
  const tab = await api.containers.openTerminal(hostId, req)
  announceTerminal(tab)
  return tab
}
