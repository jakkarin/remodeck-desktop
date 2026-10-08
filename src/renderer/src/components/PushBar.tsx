import { useState } from 'react'
import type { BranchInfo } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { showToast } from '../toast'
import { Button, TextInput } from './ui'

export function PushBar({
  workspaceId,
  branch,
  connected
}: {
  workspaceId: string
  branch: BranchInfo
  connected: boolean
}): React.JSX.Element {
  const [target, setTarget] = useState(branch.name)
  const [busy, setBusy] = useState(false)
  // Tied to the target that was pushed: editing the target makes Open PR depend on it again.
  const [pushedTarget, setPushedTarget] = useState<string | null>(null)

  const pushed = pushedTarget !== null && pushedTarget === target
  const canOpenPR = pushed || branch.base === `origin/${target}`

  async function push(): Promise<void> {
    setBusy(true)
    try {
      const out = await api.workspaces.push(workspaceId, branch.name, target)
      if (out.ok) {
        setPushedTarget(target)
        showToast('Pushed', { message: `${branch.name} → origin/${target}` })
      } else showToast('Push failed', { tone: 'error', message: out.message })
    } catch (e) {
      showToast('Push failed', { tone: 'error', message: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  async function openPR(): Promise<void> {
    try {
      await api.workspaces.openPR(workspaceId, target)
    } catch (e) {
      showToast('Could not open PR', { tone: 'error', message: errorMessage(e) })
    }
  }

  return (
    <div className="push-bar">
      <label>
        Target branch
        <TextInput value={target} onChange={(e) => setTarget(e.target.value)} />
      </label>
      <div className="push-actions">
        <Button
          variant="primary"
          aria-label="Push to GitHub"
          disabled={!connected || busy || !target}
          title={connected ? undefined : 'Host is not connected'}
          onClick={() => void push()}
        >
          ↑ Push
        </Button>
        <Button disabled={!canOpenPR} onClick={() => void openPR()}>
          Open PR
        </Button>
      </div>
    </div>
  )
}
