import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApprovalModal } from './components/ApprovalModal'
import { ActivityBar } from './components/ActivityBar'
import { ContainersModule } from './components/ContainersModule'
import { GitModule } from './components/GitModule'
import { SettingsDialog } from './components/SettingsDialog'
import { readLayout, saveCollapsed } from './layout'
import { TerminalTabs } from './components/TerminalTabs'
import { Toaster } from './components/Toaster'
import { TopBar } from './components/TopBar'
import { AppStateProvider, useAppState } from './state'
import { SettingsOpenerContext, type SettingsSection } from './settingsOpener'

/**
 * Attaches a long-lived DOM node into the layout slot. The terminals render into that node through a
 * portal owned by Layout, so they stay mounted (xterm state intact) while GitModule gates the slot away.
 */
function TerminalSlot({ node }: { node: HTMLElement }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const host = ref.current
    if (!host) return
    host.appendChild(node)
    return () => {
      node.remove()
    }
  }, [node])
  return <div ref={ref} className="terminal-slot" />
}

function Layout(): React.JSX.Element {
  const { hosts, activeHostId, activeModule } = useAppState()
  const active = hosts.find((h) => h.id === activeHostId)
  const [settings, setSettings] = useState<{ section: SettingsSection; repoId?: string } | null>(
    null
  )
  const [terminalNode] = useState(() => {
    const el = document.createElement('div')
    el.className = 'terminal-portal'
    return el
  })
  const [collapsed, setCollapsed] = useState(() => readLayout().collapsed)

  const toggle = (): void => {
    saveCollapsed(!collapsed)
    setCollapsed(!collapsed)
  }

  return (
    <SettingsOpenerContext.Provider value={(section, repoId) => setSettings({ section, repoId })}>
      <div className={active?.protected ? 'app protected' : 'app'}>
        <TopBar />
        <div className="app-body">
          <ActivityBar onOpenSettings={() => setSettings({ section: 'general' })} />
          <main className="main">
            {activeModule === 'git' ? (
              <GitModule
                bottom={<TerminalSlot node={terminalNode} />}
                bottomCollapsed={collapsed}
              />
            ) : (
              <ContainersModule
                bottom={<TerminalSlot node={terminalNode} />}
                bottomCollapsed={collapsed}
              />
            )}
          </main>
        </div>
        {createPortal(<TerminalTabs collapsed={collapsed} onToggle={toggle} />, terminalNode)}
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
      <Toaster />
    </AppStateProvider>
  )
}

export default App
