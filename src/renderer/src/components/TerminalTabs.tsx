import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { watchColorScheme, xtermTheme } from '../theme'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { api } from '../api'
import { onTerminalOpened } from '../terminalEvents'

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
    const term = new Terminal({ fontSize: 13, cursorBlink: true, theme: readTheme() })
    const unwatch = watchColorScheme(() => {
      term.options.theme = readTheme()
    })
    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)
    term.open(host.current!)
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

export function TerminalTabs(): React.JSX.Element | null {
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

  if (tabs.length === 0) return null
  return (
    <div className="terminal-panel" id="terminal-panel">
      <div className="terminal-tabbar">
        {tabs.map((t) => (
          <div key={t.tabId} className={`terminal-tab${t.tabId === activeId ? ' active' : ''}`}>
            <button className="terminal-tab-label" onClick={() => setActiveId(t.tabId)}>
              {t.label}
              {t.exited ? ` ${CLOSED}` : ''}
            </button>
            <button aria-label={`Close ${t.label}`} onClick={() => close(t.tabId)}>
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="terminal-body">
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
