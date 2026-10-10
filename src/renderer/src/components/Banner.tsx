import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from 'cn'
import { Button } from './ui/button'

const tones = {
  danger: 'bg-destructive-soft text-destructive',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-muted text-foreground'
} as const

export function Banner({
  tone,
  children,
  action,
  onDismiss
}: {
  tone: 'danger' | 'warning' | 'info'
  children: ReactNode
  action?: ReactNode
  onDismiss?(): void
}): React.JSX.Element {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('m-1.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs', tones[tone])}
    >
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {action}
      {onDismiss && (
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={onDismiss}>
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}
