import { useCallback, useEffect, useState } from 'react'
import type { ContainerInfo } from '../../shared/containers'
import { api, errorMessage } from './api'

type Loaded = {
  hostId: string | null
  list: ContainerInfo[] | null
  live: boolean
  error: string | null
}

export function useContainers(hostId: string): {
  list: ContainerInfo[] | null
  live: boolean
  error: string | null
  retry(): void
} {
  const [state, setState] = useState<Loaded>({ hostId, list: null, live: false, error: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let changed = false
    let liveSeen = false
    // A state left over from another host is discarded on the first write for this one.
    const base = (s: Loaded): Loaded =>
      s.hostId === hostId ? s : { hostId, list: null, live: false, error: null }
    const offChanged = api.on('containers-changed', (id, list) => {
      if (active && id === hostId) {
        changed = true
        setState((s) => ({ ...base(s), list, error: null }))
      }
    })
    const offLive = api.on('containers-live', (id, live) => {
      if (active && id === hostId) {
        liveSeen = true
        setState((s) => ({ ...base(s), live }))
      }
    })
    api.containers.open(hostId).then(
      (res) => {
        // Pushed lists/live flags that arrived while open was pending are newer than open's reply.
        if (active)
          setState((s) => {
            const b = base(s)
            return {
              ...b,
              list: changed ? b.list : res.list,
              live: liveSeen ? b.live : res.live,
              error: null
            }
          })
      },
      (e) => {
        if (active) setState((s) => ({ ...base(s), error: errorMessage(e) }))
      }
    )
    return () => {
      active = false
      // Nothing loaded for this host may be shown once the subscription is gone.
      setState({ hostId: null, list: null, live: false, error: null })
      offChanged()
      offLive()
    }
  }, [hostId, attempt])

  const retry = useCallback(() => {
    setState((s) => ({ ...s, error: null }))
    setAttempt((n) => n + 1)
  }, [])

  // Until the effect resets state for a new host, never expose the previous host's data.
  if (state.hostId !== hostId) return { list: null, live: false, error: null, retry }
  return { list: state.list, live: state.live, error: state.error, retry }
}
