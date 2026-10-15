import { useCallback, useEffect, useRef, useState } from 'react'
import type { HostTerminalRequest } from '../../shared/containers'
import { api } from './api'
import { openHostTerminal } from './terminalEvents'

type Session = { tabId: string | null; exited: Set<string> }

/**
 * Opens a host command terminal and calls onExit once that tab exits or the user closes it.
 * Changing scope (e.g. the host) abandons a running command without calling onExit.
 */
export function useHostCommandTerminal(
  scope: string,
  onExit: () => void
): { running: boolean; run(hostId: string, req: HostTerminalRequest): Promise<void> } {
  const session = useRef<Session | null>(null)
  const [running, setRunning] = useState(false)
  const onExitRef = useRef(onExit)
  useEffect(() => {
    onExitRef.current = onExit
  })

  const finish = useCallback((s: Session): void => {
    if (session.current !== s) return
    session.current = null
    setRunning(false)
    onExitRef.current()
  }, [])

  useEffect(() => {
    // Subscribe before opening: a short command can exit before IPC returns its tab id.
    const off = api.on('terminal-exit', (tabId) => {
      const s = session.current
      if (!s) return
      if (s.tabId === null) s.exited.add(tabId)
      else if (s.tabId === tabId) finish(s)
    })
    return () => {
      off()
      session.current = null
      setRunning(false)
    }
  }, [scope, finish])

  const run = useCallback(
    async (hostId: string, req: HostTerminalRequest): Promise<void> => {
      const s: Session = { tabId: null, exited: new Set() }
      session.current = s
      setRunning(true)
      try {
        const tab = await openHostTerminal(hostId, req)
        if (session.current !== s) return
        s.tabId = tab.tabId
        if (s.exited.has(tab.tabId)) finish(s)
        s.exited.clear()
      } catch (e) {
        if (session.current === s) {
          session.current = null
          setRunning(false)
        }
        throw e
      }
    },
    [finish]
  )

  return { running, run }
}
