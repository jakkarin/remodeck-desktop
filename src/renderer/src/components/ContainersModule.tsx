import { useRef, useState } from 'react'
import { Container } from 'lucide-react'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { useProbeOnce } from '../useProbeOnce'
import { Button } from './ui'
import { EmptyState } from './EmptyState'
import { ContainersView } from './ContainersView'
import { LAYOUT_KEY, MIN_BOTTOM, MIN_COL, readLayout } from '../layout'
import { startDragResize } from '../dragResize'
import { writeJson } from '../storage'

export function ContainersModule({
  bottom,
  bottomCollapsed
}: {
  bottom: React.ReactNode
  bottomCollapsed: boolean
}): React.JSX.Element {
  const { hosts, statuses, activeHostId, dockerCaps, probeDocker, setStatus } = useAppState()
  const host = hosts.find((h) => h.id === activeHostId)
  const hostId = host?.id ?? null
  const connected = hostId !== null && statuses[hostId]?.state === 'connected'
  const caps = hostId !== null ? dockerCaps[hostId] : undefined
  const needsProbe = connected && caps === undefined

  const { probe, probing, probeError } = useProbeOnce(hostId, needsProbe, probeDocker)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [bottomSize, setBottomSize] = useState(() => readLayout().bottom)
  const rootRef = useRef<HTMLDivElement>(null)

  if (!host || hostId === null) return <EmptyState />

  if (!connected) {
    const connect = async (): Promise<void> => {
      setConnectError(null)
      try {
        setStatus(hostId, await api.hosts.connect(hostId))
      } catch (e) {
        setConnectError(errorMessage(e))
      }
    }
    return (
      <div className="empty-state">
        <h2>{`${host.label} is not connected`}</h2>
        <Button variant="primary" onClick={() => void connect()}>
          Connect
        </Button>
        {connectError && <div className="error">{connectError}</div>}
      </div>
    )
  }

  if (caps === undefined) {
    const err = probeError && probeError.hostId === hostId ? probeError.message : null
    return err ? (
      <div className="empty-state">
        <div className="error">{err}</div>
        <Button disabled={probing} onClick={() => probe(hostId, true)}>
          Check again
        </Button>
      </div>
    ) : (
      <div className="empty-state muted">Checking docker…</div>
    )
  }

  if (caps.state !== 'ok') {
    return (
      <div className="empty-state">
        <Container size={32} aria-hidden="true" />
        <div style={{ whiteSpace: 'pre-wrap' }}>{caps.detail}</div>
        {probeError && probeError.hostId === hostId && (
          <div className="error">{probeError.message}</div>
        )}
        <Button disabled={probing} onClick={() => probe(hostId, true)}>
          Check again
        </Button>
      </div>
    )
  }

  const resizeBottom = (e: React.PointerEvent<HTMLDivElement>): void => {
    // A 0 height (no layout, e.g. jsdom) means no maximum.
    const h = rootRef.current?.getBoundingClientRect().height ?? 0
    startDragResize(e, {
      axis: 'y',
      start: bottomSize,
      min: MIN_BOTTOM,
      max: h > 0 ? h - MIN_COL : Infinity,
      invert: true,
      onChange: setBottomSize,
      // Shared with the Git module's layout so both keep the same terminal height.
      onEnd: (bottom) => writeJson(LAYOUT_KEY, { ...readLayout(), bottom })
    })
  }

  return (
    <div
      ref={rootRef}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        <ContainersView key={host.id} host={host} />
      </div>
      {!bottomCollapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal"
          className="split-sep split-sep-h"
          style={{ height: 6, flexShrink: 0 }}
          onPointerDown={resizeBottom}
        />
      )}
      <div style={bottomCollapsed ? undefined : { height: bottomSize, flexShrink: 0 }}>
        {bottom}
      </div>
    </div>
  )
}
