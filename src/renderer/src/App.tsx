import { useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { createPortal } from 'react-dom'
import { ApprovalModal } from './components/ApprovalModal'
import { ActivityBar } from './components/ActivityBar'
import { ContainersModule } from './components/ContainersModule'
import { GitModule } from './components/GitModule'
import { SettingsView } from './components/SettingsView'
import { DURATION, transitionFor } from './motion'
import { readLayout, saveCollapsed } from './layout'
import { TerminalTabs } from './components/TerminalTabs'
import { Toaster } from './components/Toaster'
import { TopBar } from './components/TopBar'
import { AppStateProvider, useAppState } from './state'
import { useTerminalShortcut } from './useTerminalShortcut'
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
  const { hosts, activeHostId, activeModule, selectModule } = useAppState()
  const active = hosts.find((h) => h.id === activeHostId)
  const [settings, setSettings] = useState<{ section: SettingsSection; repoId?: string }>({
    section: 'general'
  })
  const openSettings = (section: SettingsSection, repoId?: string): void => {
    setSettings({ section, repoId })
    selectModule('settings')
  }
  const [terminalNode] = useState(() => {
    const el = document.createElement('div')
    el.className = 'terminal-portal'
    return el
  })
  const [collapsed, setCollapsed] = useState(() => readLayout().collapsed)
  // Opacity-only module crossfade; reduced motion keeps a short fade.
  const reduced = useReducedMotion() ?? false
  const fade = reduced
    ? transitionFor('fast', true)
    : { duration: DURATION.fast, ease: 'easeOut' as const }

  const toggle = (): void => {
    saveCollapsed(!collapsed)
    setCollapsed(!collapsed)
  }

  useTerminalShortcut(toggle, activeModule !== 'settings')

  return (
    <SettingsOpenerContext.Provider value={openSettings}>
      <div className={active?.protected ? 'app protected' : 'app'}>
        <TopBar />
        <div className="app-body">
          <ActivityBar onOpenSettings={() => openSettings('general')} />
          <main className="main">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeModule}
                className="flex h-full min-h-0 flex-col"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={fade}
              >
                {activeModule === 'settings' ? (
                  <SettingsView
                    key={`${settings.section}:${settings.repoId ?? ''}`}
                    initialSection={settings.section}
                    initialRepoId={settings.repoId}
                  />
                ) : activeModule === 'git' ? (
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
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
        {createPortal(<TerminalTabs collapsed={collapsed} onToggle={toggle} />, terminalNode)}
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
