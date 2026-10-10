import { cn } from 'cn'

export function SectionHeader({
  title,
  description,
  actions
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="m-0 text-lg font-semibold">{title}</h1>
        {description && <p className="m-0 mt-1 text-xs text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

export function FormError({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="text-xs text-destructive">{children}</div>
}

export function Row({
  title,
  description,
  children,
  className
}: {
  title: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex items-center justify-between gap-4 px-4 py-3', className)}>
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{title}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      {children}
    </div>
  )
}
