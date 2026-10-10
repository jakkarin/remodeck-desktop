import { Container, GitBranch, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useTransitionFor } from '../motion'
import { useAppState } from '../state'
import type { Module } from '../hostContext'
import { Button } from './ui/button'

function RailButton({
  label,
  Icon,
  active,
  onClick
}: {
  label: string
  Icon: LucideIcon
  active: boolean
  onClick(): void
}): React.JSX.Element {
  const layout = useTransitionFor('layout')
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={active}
      className={`relative size-9 rounded-lg ${active ? 'bg-selected text-(--accent) hover:bg-selected' : 'text-muted-foreground'}`}
      onClick={onClick}
    >
      {active && (
        <motion.span
          layoutId="rail-indicator"
          transition={layout}
          aria-hidden="true"
          className="absolute top-[9px] -left-2 h-[18px] w-[3px] rounded-r-[3px] bg-(--accent)"
        />
      )}
      <Icon className="size-[18px]" aria-hidden="true" />
    </Button>
  )
}

export function ActivityBar({ onOpenSettings }: { onOpenSettings(): void }): React.JSX.Element {
  const { activeModule, selectModule } = useAppState()
  const is = (m: Module): boolean => activeModule === m
  return (
    <nav
      className="flex w-[52px] shrink-0 flex-col items-center gap-1 border-r bg-background py-2"
      aria-label="Activity bar"
    >
      <RailButton
        label="Git"
        Icon={GitBranch}
        active={is('git')}
        onClick={() => selectModule('git')}
      />
      <RailButton
        label="Containers"
        Icon={Container}
        active={is('containers')}
        onClick={() => selectModule('containers')}
      />
      <span className="flex-1" />
      <RailButton
        label="Settings"
        Icon={SlidersHorizontal}
        active={is('settings')}
        onClick={onOpenSettings}
      />
    </nav>
  )
}
