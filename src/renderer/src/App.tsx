import { ApprovalModal } from './components/ApprovalModal'
import { SettingsView } from './components/SettingsView'
import { Sidebar } from './components/Sidebar'
import { TerminalTabs } from './components/TerminalTabs'
import { WorkspaceView } from './components/WorkspaceView'
import { AppStateProvider, useAppState } from './state'

function Layout(): React.JSX.Element {
  const { selected } = useAppState()
  return (
    <div className="app">
      <Sidebar />
      <div className="content">
        <main className="main">
          {selected.kind === 'workspace' && selected.id ? (
            <WorkspaceView key={selected.id} workspaceId={selected.id} />
          ) : (
            <SettingsView />
          )}
        </main>
        <TerminalTabs />
      </div>
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
