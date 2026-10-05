import { Button } from './ui'
/** Mirror git errors (as opposed to e.g. timeouts) can be fixed by rebuilding the mirror. */
function isGitError(message: string): boolean {
  return message.includes('git ') || message.includes('fatal:')
}

export function ErrorBanner({
  message,
  onRebuild
}: {
  message: string
  onRebuild?(): void
}): React.JSX.Element {
  return (
    <div className="error-banner">
      <span className="error">{message}</span>
      {onRebuild && isGitError(message) && <Button onClick={onRebuild}>Rebuild mirror</Button>}
    </div>
  )
}
