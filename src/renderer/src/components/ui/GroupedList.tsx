import { useId, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

type GroupPanelProps = {
  title: string
  headingLevel?: 2 | 3 | 4
  /** Controls shown beside the title, outside the toggle button. */
  actions?: ReactNode
  /** Tooltip for the toggle. */
  titleHint?: string
  children: ReactNode
} & ({ collapsed: boolean; onToggle: () => void } | { collapsed?: never; onToggle?: never })

/** A named list surface, optionally controlled by an external collapse owner. */
export function GroupPanel({
  title,
  headingLevel = 3,
  actions,
  titleHint,
  children,
  collapsed,
  onToggle
}: GroupPanelProps): React.JSX.Element {
  const id = useId()
  const listId = `${id}-list`
  const Heading = `h${headingLevel}` as const
  return (
    <section className="ui-list-group" aria-labelledby={`${id}-title`}>
      <Heading className="ui-list-heading">
        {onToggle ? (
          <button
            type="button"
            id={`${id}-title`}
            className="ui-list-toggle"
            aria-expanded={!collapsed}
            aria-controls={listId}
            title={titleHint}
            onClick={onToggle}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            <span>{title}</span>
          </button>
        ) : (
          <span id={`${id}-title`} title={titleHint}>
            {title}
          </span>
        )}
        {actions && <span className="ui-list-heading-actions">{actions}</span>}
      </Heading>
      <ul id={listId} className="ui-group-panel" hidden={collapsed}>
        {children}
      </ul>
    </section>
  )
}

/** Compose domain content and trailing controls without row-wide interaction. */
export function ItemRow({
  children,
  actions
}: {
  children: ReactNode
  actions: ReactNode
}): React.JSX.Element {
  return (
    <li className="ui-item-row">
      <div className="ui-item-content">{children}</div>
      <div className="ui-row-actions">{actions}</div>
    </li>
  )
}
