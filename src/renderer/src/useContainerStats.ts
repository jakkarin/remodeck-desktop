import { useEffect, useState } from 'react'
import type { ContainerStats } from '../../shared/containerDetails'
import { api } from './api'

type Loaded = { hostId: string; stats: Record<string, ContainerStats> }

const NONE: Record<string, ContainerStats> = {}

export function useContainerStats(
  hostId: string,
  enabled: boolean
): Record<string, ContainerStats> {
  const [state, setState] = useState<Loaded>({ hostId, stats: NONE })

  useEffect(() => {
    return api.on('containers-stats', (id, stats) => {
      if (id === hostId) setState({ hostId, stats })
    })
  }, [hostId])

  useEffect(() => {
    if (!enabled) return
    let watching = false
    const sync = (): void => {
      const want = document.visibilityState !== 'hidden'
      if (want === watching) return
      watching = want
      api.containers.watchStats(hostId, want)
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      if (watching) api.containers.watchStats(hostId, false)
      // Drop numbers from before we stopped watching so they never flash on re-enable.
      setState((s) => (s.stats === NONE ? s : { hostId, stats: NONE }))
    }
  }, [hostId, enabled])

  // Never expose another host's numbers while the new host has none yet.
  return state.hostId === hostId ? state.stats : NONE
}
