import { useState } from 'react'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { useProbeOnce } from '../useProbeOnce'
import { Button } from './ui'
import { EmptyState } from './EmptyState'
import { WorkspaceScreen } from './WorkspaceScreen'

const NO_GIT =
  'ไม่พบ git บนเครื่องนี้ — ติดตั้งก่อน เช่น sudo apt install git หรือ sudo dnf install git แล้วกด Reload'
const NO_HTTP = 'git บนเครื่องนี้ไม่รองรับ HTTP — push/pull จาก terminal ของแอปจะใช้ไม่ได้'
const NO_FORWARD = 'sshd ปิด AllowTcpForwarding — push/pull จาก terminal ของแอปจะใช้ไม่ได้'

export function GitModule({
  bottom,
  bottomCollapsed
}: {
  bottom: React.ReactNode
  bottomCollapsed: boolean
}): React.JSX.Element {
  const {
    hosts,
    statuses,
    workspaces,
    activeHostId,
    activeWorkspaceId,
    gitCaps,
    probeGit,
    setStatus
  } = useAppState()
  const host = hosts.find((h) => h.id === activeHostId)
  const hostId = host?.id ?? null
  const connected = hostId !== null && statuses[hostId]?.state === 'connected'
  const caps = hostId !== null ? gitCaps[hostId] : undefined
  const needsProbe = connected && caps === undefined

  const { probe, probing, probeError } = useProbeOnce(hostId, needsProbe, probeGit)
  const [connectError, setConnectError] = useState<string | null>(null)

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
        <h2>{`${host.label} ยังไม่ได้ connect`}</h2>
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
          ตรวจอีกครั้ง
        </Button>
      </div>
    ) : (
      <div className="empty-state muted">กำลังตรวจ git…</div>
    )
  }

  if (caps === null) {
    return (
      <div className="empty-state">
        <div>{NO_GIT}</div>
        {probeError && probeError.hostId === hostId && (
          <div className="error">{probeError.message}</div>
        )}
        <Button disabled={probing} onClick={() => probe(hostId, true)}>
          ตรวจอีกครั้ง
        </Button>
      </div>
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
