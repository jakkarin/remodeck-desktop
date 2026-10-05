import { useState } from 'react'
import type { SettingsSection } from '../settingsOpener'
import { AppearanceSection } from './settings/AppearanceSection'
import { GeneralSection } from './settings/GeneralSection'
import { PushLogSection } from './settings/PushLogSection'
import { RepositoriesSection } from './settings/RepositoriesSection'

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'repositories', label: 'Repositories' },
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
  return (
    <div className="settings">
      <nav className="settings-nav" aria-label="Settings sections">
        <h2>Settings</h2>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={s.id === section ? 'active' : undefined}
            aria-current={s.id === section ? 'page' : undefined}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <div className="settings-panel">
        {section === 'general' && <GeneralSection />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'repositories' && <RepositoriesSection initialRepoId={initialRepoId} />}
        {section === 'pushLog' && <PushLogSection />}
      </div>
    </div>
  )
}
