import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, fireEvent, screen } from '@testing-library/react'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    on: vi.fn(() => () => undefined),
    terminal: { open: vi.fn(), close: vi.fn(), write: vi.fn(), resize: vi.fn() }
  },
  errorMessage: (e: unknown) => String(e)
}))
vi.mock('../../src/renderer/src/state', async () => {
  const { DEFAULT_PREFS } = await import('../../src/shared/types')
  return {
    useAppState: () => ({
      activeWorkspaceId: null,
      activeHostId: 'h1',
      workspaces: [],
      statuses: {},
      prefs: DEFAULT_PREFS
    })
  }
})
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown> = {}
    loadAddon = vi.fn()
    open = vi.fn()
    onData = vi.fn(() => ({ dispose: vi.fn() }))
    onResize = vi.fn(() => ({ dispose: vi.fn() }))
    write = vi.fn()
    attachCustomKeyEventHandler = vi.fn()
    hasSelection = vi.fn(() => false)
    getSelection = vi.fn(() => '')
    clearSelection = vi.fn()
    paste = vi.fn()
    dispose = vi.fn()
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  }
}))

import { TerminalTabs } from '../../src/renderer/src/components/TerminalTabs'
import { announceTerminal } from '../../src/renderer/src/terminalEvents'
import { api } from '../../src/renderer/src/api'

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
})

const tab = { tabId: 't1', label: 'logs', hostId: 'h1' }

describe('TerminalTabs', () => {
  it('closes the tab in main and ignores the exit main sends back for it', () => {
    const exitHandlers: ((tabId: string, code: number) => void)[] = []
    vi.mocked(api.on).mockImplementation(((event: string, cb: never) => {
      if (event === 'terminal-exit') exitHandlers.push(cb)
      return () => undefined
    }) as never)
    render(<TerminalTabs collapsed={false} onToggle={vi.fn()} />)
    act(() => announceTerminal(tab))
    fireEvent.click(screen.getByRole('button', { name: 'Close logs' }))
    expect(api.terminal.close).toHaveBeenCalledWith('t1')
    expect(screen.queryByRole('button', { name: 'Close logs' })).toBeNull()
    expect(() => act(() => exitHandlers.forEach((h) => h('t1', -1)))).not.toThrow()
    expect(screen.queryByRole('button', { name: 'Close logs' })).toBeNull()
    vi.mocked(api.on).mockImplementation(() => () => undefined)
  })
  it('expands when a tab opens while collapsed', () => {
    const onToggle = vi.fn()
    render(<TerminalTabs collapsed onToggle={onToggle} />)
    act(() => announceTerminal(tab))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('does not toggle when already expanded', () => {
    const onToggle = vi.fn()
    render(<TerminalTabs collapsed={false} onToggle={onToggle} />)
    act(() => announceTerminal(tab))
    expect(onToggle).not.toHaveBeenCalled()
  })
})
