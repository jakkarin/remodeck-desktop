import { useCallback, useEffect, useState } from 'react'
import type { ContainerInfo } from '../../shared/containers'
import { api, errorMessage } from './api'

type Loaded = { hostId: string; list: ContainerInfo[] | null; live: boolean; error: string | null }

export function useContainers(hostId: string): {
  list: ContainerInfo[] | null
  live: boolean
  error: string | null
  retry(): void
} {
  const [state, setState] = useState<Loaded>({ hostId, list: null, live: true, error: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    // A state left over from another host is discarded on the first write for this one.
    const base = (s: Loaded): Loaded =>
      s.hostId === hostId ? s : { hostId, list: null, live: true, error: null }
    const offChanged = api.on('containers-changed', (id, list) => {
      if (active && id === hostId) setState((s) => ({ ...base(s), list, error: null }))
    })
    const offLive = api.on('containers-live', (id, live) => {
      if (active && id === hostId) setState((s) => ({ ...base(s), live }))
    })
    api.containers.open(hostId).then(
      (list) => {
        if (active) setState((s) => ({ ...base(s), list, live: true, error: null }))
      },
      (e) => {
        if (active) setState((s) => ({ ...base(s), error: errorMessage(e) }))
      }
    )
    return () => {
      active = false
      offChanged()
      offLive()
    }
  }, [hostId, attempt])

  const retry = useCallback(() => {
    setState((s) => ({ ...s, error: null }))
    setAttempt((n) => n + 1)
  }, [])

  // Until the effect resets state for a new host, never expose the previous host's data.
  if (state.hostId !== hostId) return { list: null, live: true, error: null, retry }
  return { list: state.list, live: state.live, error: state.error, retry }
}
