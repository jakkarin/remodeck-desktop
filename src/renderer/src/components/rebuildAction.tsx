import type { ReactNode } from 'react'
import { Button } from './ui/button'

/** Mirror git errors (as opposed to e.g. timeouts) can be fixed by rebuilding the mirror. */
function isGitError(message: string): boolean {
  return message.includes('git ') || message.includes('fatal:')
}

/** The "Rebuild mirror" action for a banner, only for errors a rebuild can fix. */
export function rebuildAction(message: string, onRebuild?: () => void): ReactNode {
  if (!onRebuild || !isGitError(message)) return undefined
  return (
    <Button variant="outline" size="sm" onClick={onRebuild}>
      Rebuild mirror
    </Button>
  )
}
