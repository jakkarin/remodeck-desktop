import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Host, HostStatus, Repo, SyncInfo, Workspace } from '../../shared/types'
import { api } from './api'

export type AppState = {
  hosts: Host[]
  statuses: Record<string, HostStatus>
  repos: Repo[]
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  selectWorkspace(id: string | null): void
  syncInfo: Record<string, SyncInfo>
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
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)
  const [syncInfo, setSyncInfo] = useState<Record<string, SyncInfo>>({})
  const activeRef = useRef<string | null>(null)
  const loadedRef = useRef(false)

  const selectWorkspace = useCallback((id: string | null) => {
    activeRef.current = id
    setActiveWorkspaceId(id)
    api.workspaces.setActive(id)
  }, [])

  const setStatus = useCallback((hostId: string, s: HostStatus) => {
    setStatuses((prev) => ({ ...prev, [hostId]: s }))
  }, [])

  const refresh = useCallback(async () => {
    const [h, r, w] = await Promise.all([api.hosts.list(), api.repos.list(), api.workspaces.list()])
    setHosts(h)
    setRepos(r)
    setWorkspaces(w)
    const current = activeRef.current
    if (!loadedRef.current || (current !== null && !w.some((x) => x.id === current))) {
      loadedRef.current = true
      selectWorkspace(w[0]?.id ?? null)
    }
    const entries = await Promise.all(
      h.map(async (host) => [host.id, await api.hosts.status(host.id)] as const)
    )
    setStatuses(Object.fromEntries(entries))
  }, [selectWorkspace])

  useEffect(() => {
    // refresh is async: state is set after awaiting IPC, not synchronously in the effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().catch(() => undefined)
    const offStatus = api.on('host-status', setStatus)
    const offSynced = api.on('workspace-synced', (id, info) =>
      setSyncInfo((prev) => ({ ...prev, [id]: info }))
    )
    return () => {
      offStatus()
      offSynced()
    }
  }, [refresh, setStatus])

  const value = useMemo<AppState>(
    () => ({
      hosts,
      statuses,
      repos,
      workspaces,
      activeWorkspaceId,
      selectWorkspace,
      syncInfo,
      setStatus,
      refresh
    }),
    [
      hosts,
      statuses,
      repos,
      workspaces,
      activeWorkspaceId,
      selectWorkspace,
      syncInfo,
      setStatus,
      refresh
    ]
  )
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}
