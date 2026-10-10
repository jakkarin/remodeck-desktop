import { useRef, useState } from 'react'
import { CircleAlert, Loader2, Server } from 'lucide-react'
import type { Host } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { Button } from './ui/button'
import { HostSettingsDialog } from './HostSettingsDialog'
import { MonoLine, StatePanel } from './StatePanel'

/** Shown in place of a module while its host is not connected. */
export function ConnectPanel({ host }: { host: Host }): React.JSX.Element {
  const { statuses, setStatus } = useAppState()
  const [inFlight, setInFlight] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [settings, setSettings] = useState(false)
  const submitting = useRef(false)

  const status = statuses[host.id]
  const connecting = inFlight || status?.state === 'connecting'
  const error =
    failure ?? (status?.state === 'error' ? (status.error ?? 'Connection failed') : null)

  const connect = async (): Promise<void> => {
    if (submitting.current) return
    submitting.current = true
    setInFlight(true)
    setFailure(null)
    try {
      const next = await api.hosts.connect(host.id)
      setStatus(host.id, next)
      if (next.state === 'error') setFailure(next.error ?? 'Connection failed')
    } catch (e) {
      setFailure(errorMessage(e))
    } finally {
      submitting.current = false
      setInFlight(false)
    }
  }

  const spinner = connecting && <Loader2 aria-hidden="true" className="animate-spin" />

  return (
    <>
      {error !== null ? (
        <StatePanel
          tone="danger"
          icon={<CircleAlert size={18} />}
          title={`Couldn’t reach ${host.label}`}
          description={<MonoLine tone="danger">{error}</MonoLine>}
        >
          <div className="flex gap-2">
            <Button size="lg" disabled={connecting} onClick={() => void connect()}>
              {spinner}
              Retry
            </Button>
            <Button variant="outline" size="lg" onClick={() => setSettings(true)}>
              Host settings
            </Button>
          </div>
        </StatePanel>
      ) : (
        <StatePanel
          icon={<Server size={18} />}
          title={`${host.label} is not connected`}
          description={
            <>
              Connects over <MonoLine>{`ssh ${host.sshHost}`}</MonoLine>
            </>
          }
        >
          <Button size="lg" disabled={connecting} onClick={() => void connect()}>
            {spinner}
            Connect
          </Button>
        </StatePanel>
      )}
      {settings && <HostSettingsDialog host={host} onClose={() => setSettings(false)} />}
    </>
  )
}
