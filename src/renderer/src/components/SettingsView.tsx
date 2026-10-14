import { useEffect, useRef, useState } from 'react'
import { cn } from 'cn'
import type { SettingsSection } from '../settingsOpener'
import { GeneralSection } from './settings/GeneralSection'
import { GitTokensSection } from './settings/GitTokensSection'
import { PushLogSection } from './settings/PushLogSection'
import { RepositoriesSection } from './settings/RepositoriesSection'

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'repositories', label: 'Repositories' },
  { id: 'gitTokens', label: 'Git tokens' },
  { id: 'pushLog', label: 'Push log' }
]

export function SettingsView({
  initialSection = 'general',
  initialRepoId
}: {
  initialSection?: SettingsSection
  initialRepoId?: string
}): React.JSX.Element {
  const [section, setSection] = useState<SettingsSection>(initialSection)
  const navRef = useRef<HTMLElement>(null)
  // the control that opened Settings unmounts or hides, so hand focus to the page
  useEffect(() => {
    navRef.current?.focus()
  }, [])
  return (
    <section
      aria-label="Settings"
      className="flex min-h-0 flex-1 flex-col overflow-auto bg-ground sm:flex-row"
    >
      <nav
        ref={navRef}
        tabIndex={-1}
        aria-label="Settings sections"
        className="flex shrink-0 flex-row flex-wrap outline-none gap-0.5 border-b bg-background p-3 sm:w-[200px] sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0"
      >
        <div className="m-0 w-full px-2 pb-2 text-xs font-semibold text-muted-foreground">
          Settings
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-current={s.id === section ? 'page' : undefined}
            className={cn(
              'rounded-md px-2 py-1.5 text-left text-[13px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/30',
              s.id === section && 'bg-selected font-medium text-selected-foreground'
            )}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto flex max-w-[760px] flex-col gap-4">
          {section === 'general' && <GeneralSection />}
          {section === 'repositories' && <RepositoriesSection initialRepoId={initialRepoId} />}
          {section === 'gitTokens' && <GitTokensSection />}
          {section === 'pushLog' && <PushLogSection />}
        </div>
      </div>
    </section>
  )
}
