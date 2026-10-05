import { useState } from 'react'
import { ApprovalModal } from './components/ApprovalModal'
import { EmptyState } from './components/EmptyState'
import { SettingsDialog } from './components/SettingsDialog'
import { readLayout, saveCollapsed } from './layout'
import { TerminalTabs } from './components/TerminalTabs'
import { TopBar } from './components/TopBar'
import { WorkspaceScreen } from './components/WorkspaceScreen'
import { AppStateProvider, useAppState } from './state'

function Layout(): React.JSX.Element {
  const { activeWorkspaceId, workspaces } = useAppState()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => readLayout().collapsed)

  const toggle = (): void => {
    saveCollapsed(!collapsed)
    setCollapsed(!collapsed)
  }

  const active = workspaces.find((w) => w.id === activeWorkspaceId)
  return (
    <div className="app">
      <TopBar onOpenSettings={() => setSettingsOpen(true)} />
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
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
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
