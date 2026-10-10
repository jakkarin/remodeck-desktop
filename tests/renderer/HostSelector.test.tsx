import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DEFAULT_PREFS, type HostStatus } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    hosts: {
      connect: vi.fn(),
      disconnect: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
      update: vi.fn(),
      status: vi.fn()
    }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { HostSelector } from '../../src/renderer/src/components/HostSelector'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'
import { SettingsOpenerContext } from '../../src/renderer/src/settingsOpener'

const down: HostStatus = { state: 'disconnected' }
const up: HostStatus = { state: 'connected' }

function renderWith(statuses: Record<string, HostStatus>, over: Partial<AppState> = {}): AppState {
  const value: AppState = {
    hosts: [
      { id: 'h1', sshHost: 'a', label: 'Alpha', protected: false },
      { id: 'h2', sshHost: 'b', label: 'Beta', protected: false }
    ],
    statuses,
    repos: [],
    workspaces: [{ id: 'w1', repoId: 'r1', hostId: 'h1', sandboxPath: '~/repos/api' }],
    activeHostId: 'h1',
    selectHost: vi.fn(),
    gitCaps: {},
    probeGit: vi.fn(),
    dockerCaps: {},
    probeDocker: vi.fn(),
    activeModule: 'git',
    selectModule: vi.fn(),
    activeWorkspaceId: 'w1',
    selectWorkspace: vi.fn(),
    syncInfo: {},
    setStatus: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    prefs: DEFAULT_PREFS,
    updatePrefs: vi.fn().mockResolvedValue(undefined),
    ...over
  }
  render(
    <AppStateContext.Provider value={value}>
      <SettingsOpenerContext.Provider value={vi.fn()}>
        <HostSelector />
      </SettingsOpenerContext.Provider>
    </AppStateContext.Provider>
  )
  return value
}
const open = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Switch host' }))
}
/** Radix opens dropdown menus on pointerdown or Enter; jsdom lacks PointerEvent, so use the keyboard. */
const openRowMenu = (label: string): void => {
  fireEvent.keyDown(screen.getByRole('button', { name: `Host menu ${label}` }), { key: 'Enter' })
}
const panelGone = (): void => expect(screen.queryByRole('button', { name: 'Add host…' })).toBeNull()

beforeEach(() => vi.clearAllMocks())

describe('HostSelector', () => {
  it('trigger shows the active host label', () => {
    renderWith({ h1: up, h2: up })
    expect(screen.getByRole('button', { name: 'Switch host' })).toHaveTextContent('Alpha')
  })

  it('trigger marks a protected active host', () => {
    renderWith(
      { h1: up, h2: up },
      { hosts: [{ id: 'h1', sshHost: 'a', label: 'Alpha', protected: true }] }
    )
    expect(screen.getByRole('button', { name: 'Switch host' })).toHaveTextContent('protected')
  })

  it('trigger shows no protected badge for a normal host', () => {
    renderWith({ h1: up, h2: up })
    expect(screen.getByRole('button', { name: 'Switch host' })).not.toHaveTextContent('protected')
  })

  it('rows mark protected hosts', () => {
    renderWith(
      { h1: up, h2: up },
      {
        hosts: [
          { id: 'h1', sshHost: 'a', label: 'Alpha', protected: false },
          { id: 'h2', sshHost: 'b', label: 'Beta', protected: true }
        ]
      }
    )
    open()
    expect(screen.getAllByText('protected')).toHaveLength(1)
  })

  it('trigger prompts when no host is active', () => {
    renderWith({ h1: up, h2: up }, { activeHostId: null })
    expect(screen.getByRole('button', { name: 'Switch host' })).toHaveTextContent('Select host')
  })

  it('lists hosts with status dots and marks the active one', () => {
    renderWith({ h1: up, h2: { state: 'error', error: 'boom' } })
    open()
    const alpha = screen.getByRole('button', { name: 'Alpha' })
    const beta = screen.getByRole('button', { name: 'Beta' })
    expect(alpha).toHaveAttribute('aria-current', 'true')
    expect(beta).not.toHaveAttribute('aria-current')
    expect(alpha.querySelector('[data-status]')).toHaveAttribute('data-status', 'connected')
    expect(beta.querySelector('[data-status]')).toHaveAttribute('data-status', 'error')
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('shows ssh host and state text on the second line', () => {
    renderWith({ h1: up, h2: down })
    open()
    expect(screen.getByText('ssh a · connected')).toBeInTheDocument()
    expect(screen.getByText('ssh b · not connected')).toBeInTheDocument()
  })

  it('pulses the dot only while connecting', () => {
    renderWith({ h1: { state: 'connecting' }, h2: up })
    open()
    expect(screen.getByText('ssh a · connecting…')).toBeInTheDocument()
    const dots = [...document.querySelectorAll('[data-status]')]
    expect(dots.some((d) => d.getAttribute('data-status') === 'connecting')).toBe(true)
    for (const d of dots) {
      expect(d.classList.contains('animate-pulse')).toBe(
        d.getAttribute('data-status') === 'connecting'
      )
    }
  })

  it('clicking another host selects it and closes the panel', async () => {
    const v = renderWith({ h1: up, h2: up })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
    expect(v.selectHost).toHaveBeenCalledWith('h2')
    await waitFor(panelGone)
  })

  it('shows Connect only when disconnected and Retry only on error', () => {
    renderWith({ h1: down, h2: { state: 'error', error: 'x' } })
    open()
    expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1)
  })

  it('Connect calls api.hosts.connect then setStatus', async () => {
    vi.mocked(api.hosts.connect).mockResolvedValue(up)
    const v = renderWith({ h1: down, h2: up })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(api.hosts.connect).toHaveBeenCalledWith('h1')
    await waitFor(() => expect(v.setStatus).toHaveBeenCalledWith('h1', up))
  })

  it('Retry on an error host calls api.hosts.connect', async () => {
    vi.mocked(api.hosts.connect).mockResolvedValue(up)
    const v = renderWith({ h1: { state: 'error', error: 'boom' }, h2: up })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.hosts.connect).toHaveBeenCalledWith('h1')
    await waitFor(() => expect(v.setStatus).toHaveBeenCalledWith('h1', up))
  })

  it('Remove host is disabled with a tooltip while it has workspaces', async () => {
    renderWith({ h1: up, h2: up })
    open()
    openRowMenu('Alpha')
    const item = await screen.findByRole('menuitem', { name: 'Remove host…' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveAttribute('title')
  })

  it('Remove host works for an empty host', async () => {
    vi.mocked(api.hosts.remove).mockResolvedValue(undefined)
    const v = renderWith({ h1: up, h2: up })
    open()
    openRowMenu('Beta')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove host…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove host' })
    await waitFor(panelGone)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(v.refresh).toHaveBeenCalled())
    expect(api.hosts.remove).toHaveBeenCalledWith('h2')
  })

  it('Disconnect is offered for a connected host', async () => {
    vi.mocked(api.hosts.disconnect).mockResolvedValue(undefined)
    vi.mocked(api.hosts.status).mockResolvedValue(down)
    const v = renderWith({ h1: up, h2: down })
    open()
    openRowMenu('Alpha')
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Disconnect' }))
    await waitFor(() => expect(v.setStatus).toHaveBeenCalledWith('h1', down))
  })

  it('Disconnect is not offered for a disconnected host', async () => {
    renderWith({ h1: up, h2: down })
    open()
    openRowMenu('Beta')
    await screen.findByRole('menuitem', { name: 'Remove host…' })
    expect(screen.queryByRole('menuitem', { name: 'Disconnect' })).toBeNull()
  })

  it('Settings for <host> opens the dialog, closes the panel and saves the new label', async () => {
    vi.mocked(api.hosts.update).mockResolvedValue({
      id: 'h1',
      sshHost: 'a',
      label: 'Work',
      protected: false
    })
    const v = renderWith({ h1: up, h2: up })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Settings for Alpha' }))
    const dialog = screen.getByRole('dialog', { name: 'Host settings' })
    // the popover closes so it does not stay open behind the dialog
    await waitFor(panelGone)
    fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: ' Work ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.hosts.update).toHaveBeenCalledWith('h1', { label: 'Work', protected: false })
    )
    await waitFor(() => expect(v.refresh).toHaveBeenCalled())
  })

  it('Add host opens the add dialog', async () => {
    renderWith({ h1: up, h2: up })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Add host…' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Settings for Alpha' })).toBeNull()
    )
  })

  it('Escape closes the popover and returns focus to the trigger', async () => {
    renderWith({ h1: up, h2: up })
    open()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Beta' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Switch host' })).toHaveFocus())
  })

  it('closes on an outside pointerdown', async () => {
    renderWith({ h1: up, h2: up })
    open()
    // Radix arms its outside-click listener on the next tick
    await new Promise((r) => setTimeout(r, 10))
    fireEvent.pointerDown(screen.getByText('Beta'))
    expect(screen.queryByText('Beta')).not.toBeNull()
    // Radix defers the dismissal to the click that follows a primary-button pointerdown
    fireEvent.pointerDown(document.body)
    fireEvent.click(document.body)
    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull())
  })
})
