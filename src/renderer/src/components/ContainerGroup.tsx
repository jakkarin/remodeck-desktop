import { useId, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from 'cn'

/** Shared column template for the header row and every container row. */
export const CONTAINER_GRID =
  'grid grid-cols-[14px_minmax(150px,1.4fr)_minmax(120px,1.2fr)_minmax(80px,110px)_60px_76px_144px] items-center gap-2.5'

const COLUMNS = ['Name', 'Image', 'Ports', 'CPU', 'Memory']

/** A named group of container rows: heading, optional toggle and actions, column header, rows. */
export function ContainerGroup({
  title,
  meta,
  actions,
  titleHint,
  collapsed,
  onToggle,
  children
}: {
  title: string
  meta: string
  actions?: ReactNode
  /** Tooltip for the toggle. */
  titleHint?: string
  collapsed?: boolean
  onToggle?: () => void
  children: ReactNode
}): React.JSX.Element {
  const id = useId()
  const listId = `${id}-list`
  return (
    <section aria-labelledby={`${id}-title`} className="pb-2">
      <h3 className="m-0 flex flex-wrap items-center gap-2.5 px-3.5 pt-3 pb-1.5 text-[13px]">
        {onToggle ? (
          <button
            type="button"
            id={`${id}-title`}
            aria-expanded={!collapsed}
            aria-controls={listId}
            title={titleHint}
            onClick={onToggle}
            className="flex items-center gap-2 rounded-md font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <span aria-hidden="true" className="text-muted-foreground">
              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
            <span>{title}</span>
          </button>
        ) : (
          <span id={`${id}-title`} className="font-semibold">
            {title}
          </span>
        )}
        <span className="text-xs font-normal text-muted-foreground">{meta}</span>
        {actions && <span className="ml-auto flex gap-1 font-normal">{actions}</span>}
      </h3>
      <div hidden={collapsed} className="overflow-x-auto">
        <div className="flex min-w-[760px] flex-col px-1.5">
          <div
            aria-hidden="true"
            className={cn(
              CONTAINER_GRID,
              'px-2 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase'
            )}
          >
            <span />
            {COLUMNS.map((c) => (
              <span key={c}>{c}</span>
            ))}
            <span />
          </div>
          <ul id={listId} className="m-0 flex list-none flex-col p-0">
            {children}
          </ul>
        </div>
      </div>
    </section>
  )
}
