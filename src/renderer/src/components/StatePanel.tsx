import type { ReactNode } from 'react'
import { cn } from 'cn'

/** Centered card for host-level states (not connected, git missing, no workspaces). */
export function StatePanel({
  icon,
  title,
  description,
  tone = 'neutral',
  children
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  tone?: 'neutral' | 'danger'
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-ground p-6 text-center">
      {icon && (
        <div
          aria-hidden="true"
          className={cn(
            'flex size-10 items-center justify-center rounded-[11px]',
            tone === 'danger' ? 'bg-destructive-soft text-destructive' : 'bg-muted text-foreground'
          )}
        >
          {icon}
        </div>
      )}
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {description && <div className="text-muted-foreground">{description}</div>}
      {children}
    </div>
  )
}

/** Inline mono text used in StatePanel descriptions. */
export function MonoLine({
  tone = 'plain',
  children
}: {
  tone?: 'plain' | 'danger' | 'command'
  children: ReactNode
}): React.JSX.Element {
  return (
    <code
      className={cn(
        'font-mono text-xs',
        tone === 'danger' &&
          'max-w-105 rounded-lg bg-destructive-soft px-3 py-2 text-left break-words text-destructive',
        tone === 'command' && 'rounded-[7px] bg-foreground px-2.5 py-1.5 text-background'
      )}
    >
      {children}
    </code>
  )
}
