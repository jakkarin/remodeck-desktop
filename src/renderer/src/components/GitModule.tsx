import { CircleAlert, TriangleAlert } from 'lucide-react'
import { useAppState } from '../state'
import { useProbeOnce } from '../useProbeOnce'
import { Button } from './ui/button'
import { ConnectPanel } from './ConnectPanel'
import { MonoLine, StatePanel } from './StatePanel'
import { EmptyState } from './EmptyState'
import { WorkspaceScreen } from './WorkspaceScreen'

const NO_HTTP =
  'Git on this host does not support HTTP — push/pull from the app terminal will not work'
const NO_FORWARD =
  'sshd has AllowTcpForwarding disabled — push/pull from the app terminal will not work'

export function GitModule({
  bottom,
  bottomCollapsed
}: {
  bottom: React.ReactNode
  bottomCollapsed: boolean
}): React.JSX.Element {
  const { hosts, statuses, workspaces, activeHostId, activeWorkspaceId, gitCaps, probeGit } =
    useAppState()
  const host = hosts.find((h) => h.id === activeHostId)
  const hostId = host?.id ?? null
  const connected = hostId !== null && statuses[hostId]?.state === 'connected'
  const caps = hostId !== null ? gitCaps[hostId] : undefined
  const needsProbe = connected && caps === undefined

  const { probe, probing, probeError } = useProbeOnce(hostId, needsProbe, probeGit)

  if (!host || hostId === null) return <EmptyState />

  if (!connected) return <ConnectPanel host={host} />

  if (caps === undefined) {
    const err = probeError && probeError.hostId === hostId ? probeError.message : null
    return err ? (
      <StatePanel
        tone="danger"
        icon={<CircleAlert size={18} />}
        title="Couldn’t check git"
        description={<MonoLine tone="danger">{err}</MonoLine>}
      >
        <Button variant="outline" size="lg" disabled={probing} onClick={() => probe(hostId, true)}>
          Check again
        </Button>
      </StatePanel>
    ) : (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Checking git…
      </div>
    )
  }

  if (caps === null) {
    return (
      <StatePanel
        icon={<TriangleAlert size={18} />}
        title="Git was not found on this host"
        description="Install it first, then check again."
      >
        <div className="flex flex-col items-stretch gap-1">
          <MonoLine tone="command">sudo apt install git</MonoLine>
          <MonoLine tone="command">sudo dnf install git</MonoLine>
        </div>
        {probeError && probeError.hostId === hostId && (
          <MonoLine tone="danger">{probeError.message}</MonoLine>
        )}
        <Button variant="outline" size="lg" disabled={probing} onClick={() => probe(hostId, true)}>
          Check again
        </Button>
      </StatePanel>
    )
  }

  const active = workspaces.find((w) => w.id === activeWorkspaceId && w.hostId === hostId)
  return (
    <>
      {(!caps.remoteHttp || !caps.forward) && (
        <ul className="warnings">
          {!caps.remoteHttp && <li>{NO_HTTP}</li>}
          {!caps.forward && <li>{NO_FORWARD}</li>}
        </ul>
      )}
      {active ? (
        <WorkspaceScreen
          workspaceId={active.id}
          bottom={bottom}
          bottomCollapsed={bottomCollapsed}
        />
      ) : (
        <EmptyState />
      )}
    </>
  )
}
