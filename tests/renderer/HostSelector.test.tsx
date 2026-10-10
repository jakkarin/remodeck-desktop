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
    const alpha = screen.getByRole('button', { name: 'Alpha' }).closest('section')
    const beta = screen.getByRole('button', { name: 'Beta' }).closest('section') as HTMLElement
    expect(alpha).toHaveClass('active')
    expect(beta).not.toHaveClass('active')
    expect(alpha?.querySelector('.dot')).toHaveClass('connected')
    expect(beta.querySelector('.dot')).toHaveClass('error')
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('clicking another host selects it and closes the panel', () => {
    const v = renderWith({ h1: up, h2: up })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
    expect(v.selectHost).toHaveBeenCalledWith('h2')
    expect(screen.queryByRole('button', { name: /Add host/ })).toBeNull()
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

  it('Remove host is disabled with a tooltip while it has workspaces', () => {
    renderWith({ h1: up, h2: up })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Host menu Alpha' }))
    const btn = screen.getByRole('button', { name: 'Remove host' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title')
  })

  it('Remove host works for an empty host', async () => {
    vi.mocked(api.hosts.remove).mockResolvedValue(undefined)
    const v = renderWith({ h1: up, h2: up })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Host menu Beta' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove host' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove host' })
    expect(screen.queryByRole('button', { name: /Add host/ })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(v.refresh).toHaveBeenCalled())
    expect(api.hosts.remove).toHaveBeenCalledWith('h2')
  })

  it('Disconnect is offered for a connected host', async () => {
    vi.mocked(api.hosts.disconnect).mockResolvedValue(undefined)
    vi.mocked(api.hosts.status).mockResolvedValue(down)
    const v = renderWith({ h1: up, h2: up })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Host menu Alpha' }))
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(v.setStatus).toHaveBeenCalledWith('h1', down))
  })

  it('Host settings saves the new label', async () => {
    vi.mocked(api.hosts.update).mockResolvedValue({
      id: 'h1',
      sshHost: 'a',
      label: 'Work',
      protected: false
    })
    const v = renderWith({ h1: up, h2: up })
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Host menu Alpha' }))
    fireEvent.click(screen.getByRole('button', { name: 'Host settings…' }))
    const dialog = screen.getByRole('dialog', { name: 'Host settings' })
    // the panel closes so it does not stay open behind the dialog
    expect(screen.queryByRole('button', { name: /Add host/ })).toBeNull()
    fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: ' Work ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.hosts.update).toHaveBeenCalledWith('h1', { label: 'Work', protected: false })
    )
    await waitFor(() => expect(v.refresh).toHaveBeenCalled())
  })

  it('Add host opens the add dialog', () => {
    renderWith({ h1: up, h2: up })
    open()
    fireEvent.click(screen.getByRole('button', { name: /Add host/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Host menu Alpha' })).toBeNull()
  })

  it('closes on Escape and on an outside pointerdown', () => {
    renderWith({ h1: up, h2: up })
    open()
    expect(screen.queryByText('Beta')).not.toBeNull()
    fireEvent.pointerDown(screen.getByText('Beta'))
    expect(screen.queryByText('Beta')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Beta')).toBeNull()
    open()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByText('Beta')).toBeNull()
  })
})
