import { useState } from 'react'
import { GitBranch } from 'lucide-react'
import { useAppState } from '../state'
import { Button } from './ui'
import { Button as ShButton } from './ui/button'
import { AddExistingDialog } from './AddExistingDialog'
import { AddHostDialog } from './AddHostDialog'
import { CloneDialog } from './CloneDialog'
import { ConnectPanel } from './ConnectPanel'
import { StatePanel } from './StatePanel'

/** Spec §4: nothing to show yet — no hosts, or hosts without a workspace. */
export function EmptyState(): React.JSX.Element {
  const { hosts, statuses, activeHostId, refresh, selectWorkspace } = useAppState()
  const [adding, setAdding] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [addingExisting, setAddingExisting] = useState(false)

  const host = hosts.find((h) => h.id === activeHostId)

  if (!host) {
    return (
      <div className="empty-state">
        <h2>Add your first sandbox</h2>
        <Button variant="primary" onClick={() => setAdding(true)}>
          Add host
        </Button>
        {adding && <AddHostDialog onClose={() => setAdding(false)} />}
      </div>
    )
  }

  if (statuses[host.id]?.state !== 'connected') return <ConnectPanel host={host} />

  const hostIds = [host.id]
  const opened = (w: { id: string }, close: () => void): void => {
    close()
    void refresh()
      .catch(() => undefined)
      .then(() => selectWorkspace(w.id))
  }

  return (
    <>
      <StatePanel
        icon={<GitBranch size={18} />}
        title="No workspaces yet"
        description="Clone from GitHub, or add a repo already on the host."
      >
        <div className="flex gap-2">
          <ShButton size="lg" onClick={() => setCloning(true)}>
            Clone repo
          </ShButton>
          <ShButton variant="outline" size="lg" onClick={() => setAddingExisting(true)}>
            Add existing repo
          </ShButton>
        </div>
      </StatePanel>
      {cloning && (
        <CloneDialog
          hostIds={hostIds}
          onClose={() => setCloning(false)}
          onCloned={(w) => opened(w, () => setCloning(false))}
        />
      )}
      {addingExisting && (
        <AddExistingDialog
          hostIds={hostIds}
          onClose={() => setAddingExisting(false)}
          onAdded={(w) => opened(w, () => setAddingExisting(false))}
        />
      )}
    </>
  )
}
