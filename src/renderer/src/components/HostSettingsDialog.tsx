import { useState } from 'react'
import type { Host } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { Button, TextInput } from './ui'

export function HostSettingsDialog({
  host,
  onClose
}: {
  host: Host
  onClose(): void
}): React.JSX.Element {
  const { refresh } = useAppState()
  const [label, setLabel] = useState(host.label)
  const [isProtected, setIsProtected] = useState(host.protected)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api.hosts.update(host.id, { label: label.trim(), protected: isProtected })
      await refresh()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-label="Host settings">
        <h2>Host settings</h2>
        <label>
          SSH host
          <TextInput value={host.sshHost} readOnly aria-label="SSH host" />
        </label>
        <label>
          Label
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            aria-describedby="host-protected-hint"
            checked={isProtected}
            onChange={(e) => setIsProtected(e.target.checked)}
          />
          Protected host
        </label>
        <div id="host-protected-hint" className="muted">
          แสดงแถบสีแดงและป้าย protected — การยืนยันด้วยการพิมพ์ชื่อ host
          ก่อนคำสั่งอันตรายจะมาพร้อมโมดูล Containers
        </div>
        {error && <div className="error">{error}</div>}
        <div className="dialog-actions">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !label.trim()}>
            {busy ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}
