import { useState } from 'react'
import type { BranchInfo } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { showToast } from '../toast'
import { Button } from './ui/button'
import { Input } from './ui/input'

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
    <div className="m-2 flex flex-col gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Target branch
        <Input value={target} onChange={(e) => setTarget(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button
          size="lg"
          className="flex-1"
          aria-label="Push to GitHub"
          disabled={!connected || busy || !target}
          title={connected ? undefined : 'Host is not connected'}
          onClick={() => void push()}
        >
          ↑ Push
        </Button>
        <Button variant="outline" size="lg" disabled={!canOpenPR} onClick={() => void openPR()}>
          Open PR
        </Button>
      </div>
    </div>
  )
}
