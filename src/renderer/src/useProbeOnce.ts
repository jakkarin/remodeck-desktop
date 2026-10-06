import { useEffect, useRef, useState } from 'react'
import { errorMessage } from './api'

export type ProbeOnce = {
  /** Runs the probe (optionally forced) and tracks its progress and failure. */
  probe(hostId: string, force?: boolean): void
  probing: boolean
  /** The last failure, tagged with the host it belongs to. */
  probeError: { hostId: string; message: string } | null
}

/**
 * Probe-once guard keyed by host id: fires `run(hostId)` when `needsProbe` turns on for a host, and
 * releases once the capability entry exists or is cleared (needsProbe false). `probe(id, true)` forces.
 */
export function useProbeOnce(
  hostId: string | null,
  needsProbe: boolean,
  run: (hostId: string, force?: boolean) => Promise<void>
): ProbeOnce {
  const probed = useRef<string | null>(null)
  const [probeError, setProbeError] = useState<ProbeOnce['probeError']>(null)
  const [probing, setProbing] = useState(false)

  const probe = (id: string, force?: boolean): void => {
    setProbeError(null)
    setProbing(true)
    const p = force ? run(id, true) : run(id)
    p.catch((e) => setProbeError({ hostId: id, message: errorMessage(e) })).finally(() =>
      setProbing(false)
    )
  }

  useEffect(() => {
    if (!needsProbe) {
      probed.current = null
      return
    }
    if (probed.current === hostId) return
    probed.current = hostId
    probe(hostId as string)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsProbe, hostId])

  return { probe, probing, probeError }
}
