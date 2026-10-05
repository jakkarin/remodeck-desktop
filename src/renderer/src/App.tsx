import { useState } from 'react'
import { ApprovalModal } from './components/ApprovalModal'
import { EmptyState } from './components/EmptyState'
import { SettingsDialog } from './components/SettingsDialog'
import { readLayout, saveCollapsed } from './layout'
import { TerminalTabs } from './components/TerminalTabs'
import { TopBar } from './components/TopBar'
import { WorkspaceScreen } from './components/WorkspaceScreen'
import { AppStateProvider, useAppState } from './state'
import { SettingsOpenerContext, type SettingsSection } from './settingsOpener'

function Layout(): React.JSX.Element {
  const { activeWorkspaceId, workspaces } = useAppState()
  const [settings, setSettings] = useState<{ section: SettingsSection; repoId?: string } | null>(
    null
  )
  const [collapsed, setCollapsed] = useState(() => readLayout().collapsed)

  const toggle = (): void => {
    saveCollapsed(!collapsed)
    setCollapsed(!collapsed)
  }

  const active = workspaces.find((w) => w.id === activeWorkspaceId)
  return (
    <SettingsOpenerContext.Provider value={(section, repoId) => setSettings({ section, repoId })}>
      <div className="app">
        <TopBar onOpenSettings={() => setSettings({ section: 'general' })} />
        <main className="main">
          {active ? (
            <WorkspaceScreen
              workspaceId={active.id}
              bottom={<TerminalTabs collapsed={collapsed} onToggle={toggle} />}
              bottomCollapsed={collapsed}
            />
          ) : (
            <EmptyState />
          )}
        </main>
        {settings && (
          <SettingsDialog
            key={`${settings.section}:${settings.repoId ?? ''}`}
            initialSection={settings.section}
            initialRepoId={settings.repoId}
            onClose={() => setSettings(null)}
          />
        )}
      </div>
    </SettingsOpenerContext.Provider>
  )
}

function App(): React.JSX.Element {
  return (
    <AppStateProvider>
      <Layout />
      <ApprovalModal />
    </AppStateProvider>
  )
}

export default App
