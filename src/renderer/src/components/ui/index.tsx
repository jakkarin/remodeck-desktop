import type { ComponentProps, ReactNode } from 'react'

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'secondary' | 'primary' | 'ghost' | 'danger'
}

/** Native button behavior, neutral by default; opt into submit explicitly. */
export function Button({
  variant = 'secondary',
  className = '',
  type = 'button',
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button
      {...props}
      type={type}
      className={`ui-button ui-button-${variant} ${className}`.trim()}
    />
  )
}

type IconButtonProps = Omit<ButtonProps, 'aria-label'> & { 'aria-label': string }

/** An accessible name is required for icon-only actions. */
export function IconButton({ className = '', ...props }: IconButtonProps): React.JSX.Element {
  return <Button variant="ghost" {...props} className={`icon-btn ${className}`.trim()} />
}

export function TextInput({
  className = '',
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & {
  type?: 'text' | 'password' | 'search' | 'url' | 'email' | 'number'
}): React.JSX.Element {
  return <input {...props} className={`ui-input ${className}`.trim()} />
}

export type BadgeTone = 'neutral' | 'warning' | 'success' | 'danger'

export function Badge({
  tone = 'neutral',
  className = '',
  ...props
}: ComponentProps<'span'> & {
  tone?: BadgeTone
}): React.JSX.Element {
  return <span {...props} className={`badge badge-${tone} ${className}`.trim()} />
}

export function PaneHeader({
  children,
  icon,
  actions,
  className = '',
  ...props
}: ComponentProps<'div'> & { icon?: ReactNode; actions?: ReactNode }): React.JSX.Element {
  return (
    <div {...props} className={`pane-header ${className}`.trim()}>
      {icon && (
        <span className="pane-header-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="pane-header-label">{children}</span>
      {actions && <span className="pane-header-actions">{actions}</span>}
    </div>
  )
}
