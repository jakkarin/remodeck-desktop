export type OpenedTab = { tabId: string; label: string }

const listeners = new Set<(tab: OpenedTab) => void>()

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
