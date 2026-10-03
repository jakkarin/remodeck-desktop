import { Sidebar } from './components/Sidebar'
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
            <div className="placeholder">Settings</div>
          )}
        </main>
        {/* Bottom panel slot for terminals (Task 17/18). */}
        <div className="terminal-panel" id="terminal-panel" />
      </div>
    </div>
  )
}

function App(): React.JSX.Element {
  return (
    <AppStateProvider>
      <Layout />
    </AppStateProvider>
  )
}

export default App
