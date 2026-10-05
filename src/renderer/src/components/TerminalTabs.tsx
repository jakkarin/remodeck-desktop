import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { watchColorScheme, xtermTheme } from '../theme'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { api, errorMessage } from '../api'
import { useAppState } from '../state'
import { attachClipboard } from '../terminalClipboard'
import { onTerminalOpened, openTerminal } from '../terminalEvents'
import { Button, IconButton } from './ui'

type Tab = { tabId: string; label: string; exited: boolean }

const CLOSED = '[ปิดแล้ว]'

type PaneHandle = { write(d: string): void }

function TerminalPane({
  tabId,
  active,
  register
}: {
  tabId: string
  active: boolean
  register: (tabId: string, h: PaneHandle | null) => void
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const readTheme = (): ITheme =>
      xtermTheme((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim())
    const term = new Terminal({
      fontSize: 13,
      fontFamily:
        getComputedStyle(document.documentElement).getPropertyValue('--font-code').trim() ||
        undefined,
      cursorBlink: true,
      theme: readTheme()
    })
    const unwatch = watchColorScheme(() => {
      term.options.theme = readTheme()
    })
    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)
    term.open(host.current!)
    const detachClipboard = attachClipboard(term, host.current!)
    const onData = term.onData((d) => api.terminal.write(tabId, d))
    const onResize = term.onResize(({ cols, rows }) => api.terminal.resize(tabId, cols, rows))
    const doFit = (): void => {
      try {
        fit.fit()
      } catch {
        /* container not measurable yet (hidden) */
      }
    }
    doFit()
    register(tabId, { write: (d) => term.write(d) })
    const ro = new ResizeObserver(doFit)
    ro.observe(host.current!)
    return () => {
      ro.disconnect()
      unwatch()
      detachClipboard()
      register(tabId, null)
      onData.dispose()
      onResize.dispose()
      term.dispose()
      fitRef.current = null
    }
  }, [tabId, register])

  useEffect(() => {
    if (active) {
      try {
        fitRef.current?.fit()
      } catch {
        /* ignore */
      }
    }
  }, [active])

  return <div className="terminal-pane" style={{ display: active ? 'block' : 'none' }} ref={host} />
}

export function TerminalTabs({
  collapsed,
  onToggle
}: {
  collapsed: boolean
  onToggle(): void
}): React.JSX.Element {
  const { activeWorkspaceId, workspaces, statuses } = useAppState()
  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId)
  const hostUp = !!activeWs && statuses[activeWs.hostId]?.state === 'connected'
  const [openError, setOpenError] = useState<string | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const panes = useRef(new Map<string, PaneHandle>())
  // Output that arrives before a tab's xterm is mounted (e.g. the ssh banner) is kept here and flushed on mount.
  const pending = useRef(new Map<string, string[]>())

  const deliver = useCallback((tabId: string, d: string) => {
    const pane = panes.current.get(tabId)
    if (pane) pane.write(d)
    else pending.current.set(tabId, [...(pending.current.get(tabId) ?? []), d])
  }, [])

  const register = useCallback((tabId: string, h: PaneHandle | null) => {
    if (!h) {
      panes.current.delete(tabId)
      return
    }
    panes.current.set(tabId, h)
    for (const d of pending.current.get(tabId) ?? []) h.write(d)
    pending.current.delete(tabId)
  }, [])

  useEffect(() => {
    const offData = api.on('terminal-data', deliver)
    const offExit = api.on('terminal-exit', (tabId) => {
      deliver(tabId, `\r\n${CLOSED}\r\n`)
      setTabs((prev) => prev.map((t) => (t.tabId === tabId ? { ...t, exited: true } : t)))
    })
    const offOpen = onTerminalOpened(({ tabId, label }) => {
      setTabs((prev) =>
        prev.some((t) => t.tabId === tabId) ? prev : [...prev, { tabId, label, exited: false }]
      )
      setActiveId(tabId)
    })
    return () => {
      offData()
      offExit()
      offOpen()
    }
  }, [deliver])

  function close(tabId: string): void {
    api.terminal.close(tabId)
    pending.current.delete(tabId)
    const next = tabs.filter((t) => t.tabId !== tabId)
    setTabs(next)
    if (activeId === tabId) setActiveId(next[next.length - 1]?.tabId ?? null)
  }

  async function openNew(): Promise<void> {
    if (!activeWorkspaceId) return
    setOpenError(null)
    try {
      await openTerminal(activeWorkspaceId)
    } catch (e) {
      setOpenError(errorMessage(e))
    }
  }

  const plusTitle = !activeWs
    ? 'ยังไม่ได้เลือก workspace'
    : hostUp
      ? undefined
      : 'Host ยังไม่ได้ connect'
  return (
    <div className="terminal-panel" id="terminal-panel">
      <div className="terminal-tabbar">
        <span className="terminal-title">Terminal</span>
        {tabs.map((t) => (
          <div key={t.tabId} className={`terminal-tab${t.tabId === activeId ? ' active' : ''}`}>
            <Button className="terminal-tab-label" onClick={() => setActiveId(t.tabId)}>
              {t.label}
              {t.exited ? ` ${CLOSED}` : ''}
            </Button>
            <IconButton aria-label={`Close ${t.label}`} onClick={() => close(t.tabId)}>
              ×
            </IconButton>
          </div>
        ))}
        <IconButton
          aria-label="New terminal"
          disabled={!hostUp}
          title={plusTitle}
          onClick={() => void openNew()}
        >
          <Plus size={14} />
        </IconButton>
        {openError && <span className="error">{openError}</span>}
        <span className="topbar-spacer" />
        <IconButton
          aria-label={collapsed ? 'Expand terminal' : 'Collapse terminal'}
          onClick={onToggle}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </IconButton>
      </div>
      <div className="terminal-body" style={{ display: collapsed ? 'none' : undefined }}>
        {tabs.map((t) => (
          <TerminalPane
            key={t.tabId}
            tabId={t.tabId}
            active={t.tabId === activeId}
            register={register}
          />
        ))}
      </div>
    </div>
  )
}
