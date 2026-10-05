import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { HostStatus } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    hosts: {
      connect: vi.fn(),
      disconnect: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
      status: vi.fn()
    },
    repos: { listGitHub: vi.fn().mockResolvedValue([]) },
    workspaces: { clone: vi.fn(), remove: vi.fn(), rebuildMirror: vi.fn() }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { WorkspaceSwitcher } from '../../src/renderer/src/components/WorkspaceSwitcher'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

const down: HostStatus = { state: 'disconnected', warnings: [] }
const up: HostStatus = { state: 'connected', warnings: [] }

function renderWith(statuses: Record<string, HostStatus>, over: Partial<AppState> = {}): AppState {
  const value: AppState = {
    hosts: [
      { id: 'h1', sshHost: 'a', label: 'Alpha' },
      { id: 'h2', sshHost: 'b', label: 'Beta' }
    ],
    statuses,
    repos: [
      {
        id: 'r1',
        owner: 'acme',
        name: 'api',
        defaultBranch: 'main',
        protectedBranches: [],
        alwaysAllowPush: false,
        enforceRules: false
      }
    ],
    workspaces: [{ id: 'w1', repoId: 'r1', hostId: 'h1', sandboxPath: '~/repos/api' }],
    activeWorkspaceId: 'w1',
    selectWorkspace: vi.fn(),
    syncInfo: {},
    setStatus: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    ...over
  }
  render(
    <AppStateContext.Provider value={value}>
      <WorkspaceSwitcher />
    </AppStateContext.Provider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }))
  return value
}

beforeEach(() => vi.clearAllMocks())

describe('WorkspaceSwitcher', () => {
  it('lists every host with a status dot class', () => {
    renderWith({ h1: up, h2: { state: 'error', warnings: [], error: 'boom' } })
    const alpha = screen.getByText('Alpha').closest('section') as HTMLElement
    const beta = screen.getByText('Beta').closest('section') as HTMLElement
    expect(alpha.querySelector('.dot')).toHaveClass('connected')
    expect(beta.querySelector('.dot')).toHaveClass('error')
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('shows Connect only when disconnected and Retry only on error', () => {
    renderWith({ h1: down, h2: { state: 'error', warnings: [], error: 'x' } })
    expect(screen.getAllByRole('button', { name: 'Connect' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1)
  })

  it('Connect calls api.hosts.connect', () => {
    vi.mocked(api.hosts.connect).mockResolvedValue(up)
    renderWith({ h1: down, h2: up })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(api.hosts.connect).toHaveBeenCalledWith('h1')
  })

  it('dims workspaces of a disconnected host but still selects them', () => {
    const v = renderWith({ h1: down, h2: up })
    const item = screen.getByText('acme/api · ~/repos/api').closest('li') as HTMLElement
    expect(item).toHaveClass('dim')
    fireEvent.click(screen.getByText('acme/api · ~/repos/api'))
    expect(v.selectWorkspace).toHaveBeenCalledWith('w1')
  })

  it('Remove host is disabled with a tooltip while it has workspaces', () => {
    renderWith({ h1: up, h2: up })
    fireEvent.click(screen.getByRole('button', { name: 'Host menu Alpha' }))
    const btn = screen.getByRole('button', { name: 'Remove host' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title')
  })

  it('Remove host works for an empty host', async () => {
    vi.mocked(api.hosts.remove).mockResolvedValue(undefined)
    const v = renderWith({ h1: up, h2: up })
    fireEvent.click(screen.getByRole('button', { name: 'Host menu Beta' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove host' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove host' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(v.refresh).toHaveBeenCalled())
    expect(api.hosts.remove).toHaveBeenCalledWith('h2')
  })

  it('workspace menu rebuilds the mirror', async () => {
    vi.mocked(api.workspaces.rebuildMirror).mockResolvedValue(undefined)
    renderWith({ h1: up, h2: up })
    fireEvent.click(screen.getByRole('button', { name: 'Workspace menu acme/api' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild mirror' }))
    await waitFor(() => expect(api.workspaces.rebuildMirror).toHaveBeenCalledWith('r1', 'w1'))
  })

  it('workspace menu removes the workspace', async () => {
    vi.mocked(api.workspaces.remove).mockResolvedValue(undefined)
    const v = renderWith({ h1: up, h2: up })
    fireEvent.click(screen.getByRole('button', { name: 'Workspace menu acme/api' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove workspace' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove workspace' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(v.refresh).toHaveBeenCalled())
    expect(api.workspaces.remove).toHaveBeenCalledWith('w1', false)
  })

  it('Clone repo is disabled when no host is connected', () => {
    renderWith({ h1: down, h2: down })
    expect(screen.getByRole('button', { name: /Clone repo/ })).toBeDisabled()
  })

  it('Clone repo opens the dialog with connected hosts only', () => {
    renderWith({ h1: up, h2: down })
    fireEvent.click(screen.getByRole('button', { name: /Clone repo/ }))
    const dialog = screen.getByRole('dialog', { name: 'Clone' })
    expect(within(dialog).queryByLabelText('Host')).toBeNull()
  })

  it('Clone repo offers a host choice when several are connected', () => {
    renderWith({ h1: up, h2: up })
    fireEvent.click(screen.getByRole('button', { name: /Clone repo/ }))
    const dialog = screen.getByRole('dialog', { name: 'Clone' })
    expect(within(dialog).getByLabelText('Host')).toBeInTheDocument()
  })

  it('Add host opens the add dialog', () => {
    renderWith({ h1: up, h2: up })
    fireEvent.click(screen.getByRole('button', { name: /Add host/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes on Escape, on an outside pointerdown, and after choosing a workspace', () => {
    renderWith({ h1: up, h2: up })
    const panelOpen = (): boolean => screen.queryByText('Alpha') !== null
    expect(panelOpen()).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(panelOpen()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }))
    expect(panelOpen()).toBe(true)
    fireEvent.pointerDown(screen.getByText('Alpha'))
    expect(panelOpen()).toBe(true)
    fireEvent.pointerDown(document.body)
    expect(panelOpen()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }))
    fireEvent.click(screen.getByText('acme/api · ~/repos/api'))
    expect(panelOpen()).toBe(false)
  })
})
