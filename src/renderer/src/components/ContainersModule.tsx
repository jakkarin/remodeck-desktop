import { useRef, useState } from 'react'
import { CircleAlert, Container } from 'lucide-react'
import { useAppState } from '../state'
import { useProbeOnce } from '../useProbeOnce'
import { Button } from './ui/button'
import { ConnectPanel } from './ConnectPanel'
import { MonoLine, StatePanel } from './StatePanel'
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
  const { hosts, statuses, activeHostId, dockerCaps, probeDocker } = useAppState()
  const host = hosts.find((h) => h.id === activeHostId)
  const hostId = host?.id ?? null
  const connected = hostId !== null && statuses[hostId]?.state === 'connected'
  const caps = hostId !== null ? dockerCaps[hostId] : undefined
  const needsProbe = connected && caps === undefined

  const { probe, probing, probeError } = useProbeOnce(hostId, needsProbe, probeDocker)
  const [bottomSize, setBottomSize] = useState(() => readLayout().bottom)
  const rootRef = useRef<HTMLDivElement>(null)

  if (!host || hostId === null) return <EmptyState />

  if (!connected) return <ConnectPanel host={host} />

  if (caps === undefined) {
    const err = probeError && probeError.hostId === hostId ? probeError.message : null
    return err ? (
      <StatePanel
        tone="danger"
        icon={<CircleAlert size={18} />}
        title="Couldn’t check docker"
        description={<MonoLine tone="danger">{err}</MonoLine>}
      >
        <Button variant="outline" size="lg" disabled={probing} onClick={() => probe(hostId, true)}>
          Check again
        </Button>
      </StatePanel>
    ) : (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Checking docker…
      </div>
    )
  }

  if (caps.state !== 'ok') {
    return (
      <StatePanel
        icon={<Container size={18} />}
        title="Docker is not available"
        description={<span style={{ whiteSpace: 'pre-wrap' }}>{caps.detail}</span>}
      >
        {probeError && probeError.hostId === hostId && (
          <MonoLine tone="danger">{probeError.message}</MonoLine>
        )}
        <Button variant="outline" size="lg" disabled={probing} onClick={() => probe(hostId, true)}>
          Check again
        </Button>
      </StatePanel>
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
