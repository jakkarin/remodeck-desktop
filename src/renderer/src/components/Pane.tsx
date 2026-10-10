import type { ReactNode } from 'react'
import { cn } from 'cn'

/** Card header: title row used by the three git workspace panes. */
export function PaneTitle({
  icon,
  children,
  className,
  title
}: {
  icon?: ReactNode
  children: ReactNode
  className?: string
  title?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex min-h-10 shrink-0 items-center gap-2 border-b border-border px-3.5 py-2 font-semibold',
        className
      )}
    >
      {icon && (
        <span aria-hidden="true" className="inline-flex items-center text-muted-foreground">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate" title={title}>
        {children}
      </span>
    </div>
  )
}

/** Small uppercase section label inside a pane. */
export function SectionLabel({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="px-3.5 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </div>
  )
}
