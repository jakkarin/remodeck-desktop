import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Host, HostStatus, Repo, Workspace } from '../../shared/types'
import { api } from './api'

export type Selection = { kind: 'workspace' | 'settings'; id?: string }

export type AppState = {
  hosts: Host[]
  statuses: Record<string, HostStatus>
  repos: Repo[]
  workspaces: Workspace[]
  selected: Selection
  select(s: Selection): void
  setStatus(hostId: string, s: HostStatus): void
  refresh(): Promise<void>
}

/* eslint-disable react-refresh/only-export-components -- context + hook live with the provider */
export const AppStateContext = createContext<AppState | null>(null)

export function useAppState(): AppState {
  const v = useContext(AppStateContext)
  if (!v) throw new Error('useAppState must be used inside AppStateProvider')
  return v
}

export function AppStateProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [hosts, setHosts] = useState<Host[]>([])
  const [statuses, setStatuses] = useState<Record<string, HostStatus>>({})
  const [repos, setRepos] = useState<Repo[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selected, select] = useState<Selection>({ kind: 'settings' })

  const setStatus = useCallback((hostId: string, s: HostStatus) => {
    setStatuses((prev) => ({ ...prev, [hostId]: s }))
  }, [])

  const refresh = useCallback(async () => {
    const [h, r, w] = await Promise.all([api.hosts.list(), api.repos.list(), api.workspaces.list()])
    setHosts(h)
    setRepos(r)
    setWorkspaces(w)
    const entries = await Promise.all(
      h.map(async (host) => [host.id, await api.hosts.status(host.id)] as const)
    )
    setStatuses(Object.fromEntries(entries))
  }, [])

  useEffect(() => {
    // refresh is async: state is set after awaiting IPC, not synchronously in the effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().catch(() => undefined)
    return api.on('host-status', setStatus)
  }, [refresh, setStatus])

  const value = useMemo<AppState>(
    () => ({ hosts, statuses, repos, workspaces, selected, select, setStatus, refresh }),
    [hosts, statuses, repos, workspaces, selected, setStatus, refresh]
  )
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}
