import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  DEFAULT_PREFS,
  type GitCapability,
  type Host,
  type HostStatus,
  type Prefs,
  type Repo,
  type SyncInfo,
  type Workspace
} from '../../shared/types'
import { api } from './api'
import {
  pickHost,
  pickWorkspace,
  readActiveHost,
  readLastWorkspaces,
  saveActiveHost,
  saveLastWorkspace
} from './hostContext'
import { applyTheme } from './theme'

export type AppState = {
  hosts: Host[]
  statuses: Record<string, HostStatus>
  repos: Repo[]
  workspaces: Workspace[]
  activeHostId: string | null
  selectHost(id: string): void
  /** Missing key = not probed yet; null = probed, no git. */
  gitCaps: Record<string, GitCapability | null>
  probeGit(hostId: string, force?: boolean): Promise<void>
  activeWorkspaceId: string | null
  selectWorkspace(id: string | null): void
  syncInfo: Record<string, SyncInfo>
  setStatus(hostId: string, s: HostStatus): void
  refresh(): Promise<void>
  prefs: Prefs
  updatePrefs(patch: Partial<Prefs>): Promise<void>
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
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [activeHostId, setActiveHostId] = useState<string | null>(null)
  const [gitCaps, setGitCaps] = useState<Record<string, GitCapability | null>>({})
  const activeRef = useRef<string | null>(null)
  const activeHostRef = useRef<string | null>(null)
  const workspacesRef = useRef<Workspace[]>([])
  const loadedRef = useRef(false)
  const gitEpochRef = useRef<Record<string, number>>({})

  const applyHost = useCallback((id: string | null) => {
    activeHostRef.current = id
    setActiveHostId(id)
    saveActiveHost(id)
  }, [])

  const selectWorkspace = useCallback(
    (id: string | null) => {
      activeRef.current = id
      setActiveWorkspaceId(id)
      api.workspaces.setActive(id)
      const ws = id === null ? undefined : workspacesRef.current.find((x) => x.id === id)
      if (ws) {
        applyHost(ws.hostId)
        saveLastWorkspace(ws.hostId, ws.id)
      }
    },
    [applyHost]
  )

  const selectHost = useCallback(
    (id: string) => {
      applyHost(id)
      selectWorkspace(pickWorkspace(id, workspacesRef.current, readLastWorkspaces()))
    },
    [applyHost, selectWorkspace]
  )

  const dropCaps = useCallback((hostId: string) => {
    gitEpochRef.current[hostId] = (gitEpochRef.current[hostId] ?? 0) + 1
    setGitCaps((prev) => {
      if (!(hostId in prev)) return prev
      const rest = { ...prev }
      delete rest[hostId]
      return rest
    })
  }, [])

  const probeGit = useCallback(async (hostId: string, force?: boolean) => {
    const epoch = gitEpochRef.current[hostId] ?? 0
    const caps = await api.hosts.probeGit(hostId, force)
    // the host left `connected` while probing: this result belongs to a dead session
    if ((gitEpochRef.current[hostId] ?? 0) !== epoch) return
    setGitCaps((prev) => ({ ...prev, [hostId]: caps }))
  }, [])

  const setStatus = useCallback(
    (hostId: string, s: HostStatus) => {
      setStatuses((prev) => ({ ...prev, [hostId]: s }))
      if (s.state !== 'connected') dropCaps(hostId)
    },
    [dropCaps]
  )

  const refresh = useCallback(async () => {
    const [h, r, w] = await Promise.all([api.hosts.list(), api.repos.list(), api.workspaces.list()])
    setHosts(h)
    setRepos(r)
    setWorkspaces(w)
    workspacesRef.current = w
    const hostId = pickHost(h, activeHostRef.current ?? readActiveHost())
    if (hostId !== activeHostRef.current) applyHost(hostId)
    const current = activeRef.current
    const currentOk = current !== null && w.some((x) => x.id === current && x.hostId === hostId)
    if (!loadedRef.current || (current !== null && !currentOk)) {
      loadedRef.current = true
      selectWorkspace(pickWorkspace(hostId, w, readLastWorkspaces()))
    }
    const entries = await Promise.all(
      h.map(async (host) => [host.id, await api.hosts.status(host.id)] as const)
    )
    setStatuses(Object.fromEntries(entries))
    for (const [id, st] of entries) if (st.state !== 'connected') dropCaps(id)
  }, [applyHost, selectWorkspace, dropCaps])

  const updatePrefs = useCallback(async (patch: Partial<Prefs>) => {
    setPrefs(await api.prefs.update(patch))
  }, [])

  useEffect(() => {
    applyTheme(prefs.theme)
  }, [prefs.theme])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const p = await api.prefs.get()
        if (!cancelled && p) setPrefs(p)
      } catch {
        /* keep defaults */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
      activeHostId,
      selectHost,
      gitCaps,
      probeGit,
      activeWorkspaceId,
      selectWorkspace,
      syncInfo,
      setStatus,
      refresh,
      prefs,
      updatePrefs
    }),
    [
      hosts,
      statuses,
      repos,
      workspaces,
      activeHostId,
      selectHost,
      gitCaps,
      probeGit,
      activeWorkspaceId,
      selectWorkspace,
      syncInfo,
      setStatus,
      refresh,
      prefs,
      updatePrefs
    ]
  )
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}
