import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { HostStatus } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    hosts: { connect: vi.fn(), disconnect: vi.fn(), add: vi.fn(), remove: vi.fn() },
    repos: { listGitHub: vi.fn().mockResolvedValue([]) },
    workspaces: { clone: vi.fn(), remove: vi.fn() }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { Sidebar } from '../../src/renderer/src/components/Sidebar'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

function renderWith(status: HostStatus, over: Partial<AppState> = {}): void {
  const value: AppState = {
    hosts: [{ id: 'h1', sshHost: 'box', label: 'Box' }],
    statuses: { h1: status },
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
    selected: { kind: 'settings' },
    select: vi.fn(),
    setStatus: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    ...over
  }
  render(
    <AppStateContext.Provider value={value}>
      <Sidebar />
    </AppStateContext.Provider>
  )
}

beforeEach(() => vi.clearAllMocks())

describe('Sidebar', () => {
  it('disconnected host shows Connect and a disabled Clone', () => {
    renderWith({ state: 'disconnected', warnings: [] })
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clone' })).toBeDisabled()
  })

  it('error status shows error text, warnings and Reload', () => {
    renderWith({ state: 'error', warnings: ['เตือน'], error: 'เชื่อมต่อไม่ได้' })
    expect(screen.getByText('เชื่อมต่อไม่ได้')).toBeInTheDocument()
    expect(screen.getByText('เตือน')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('clicking Connect calls api.hosts.connect', () => {
    vi.mocked(api.hosts.connect).mockResolvedValue({ state: 'connected', warnings: [] })
    renderWith({ state: 'disconnected', warnings: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(api.hosts.connect).toHaveBeenCalledWith('h1')
  })

  it('lists workspaces as owner/name · path and selects on click', () => {
    const select = vi.fn()
    renderWith({ state: 'connected', warnings: [] }, { select })
    fireEvent.click(screen.getByText('acme/api · ~/repos/api'))
    expect(select).toHaveBeenCalledWith({ kind: 'workspace', id: 'w1' })
    expect(screen.getByRole('button', { name: 'Clone' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
  })

  it('Remove host is disabled while the host has workspaces', () => {
    renderWith({ state: 'connected', warnings: [] })
    expect(screen.getByRole('button', { name: 'Remove host' })).toBeDisabled()
  })

  it('Remove host without workspaces calls api.hosts.remove and refreshes', async () => {
    vi.mocked(api.hosts.remove).mockResolvedValue(undefined)
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderWith({ state: 'disconnected', warnings: [] }, { workspaces: [], refresh })
    fireEvent.click(screen.getByRole('button', { name: 'Remove host' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove host' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(api.hosts.remove).toHaveBeenCalledWith('h1')
  })

  it('removing the last workspace of a repo offers to delete the mirror and passes the flag', async () => {
    vi.mocked(api.workspaces.remove).mockResolvedValue(undefined)
    const refresh = vi.fn().mockResolvedValue(undefined)
    const select = vi.fn()
    renderWith(
      { state: 'connected', warnings: [] },
      { refresh, select, selected: { kind: 'workspace', id: 'w1' } }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(select).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Remove workspace' })
    expect(within(dialog).getByText(/ไม่มีการลบไฟล์ใน sandbox/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByLabelText('ลบ mirror ด้วยไหม?'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(api.workspaces.remove).toHaveBeenCalledWith('w1', true)
    expect(select).toHaveBeenCalledWith({ kind: 'settings' })
  })

  it('removing a workspace that is not the last one does not offer mirror deletion', async () => {
    vi.mocked(api.workspaces.remove).mockResolvedValue(undefined)
    const refresh = vi.fn().mockResolvedValue(undefined)
    const select = vi.fn()
    renderWith(
      { state: 'connected', warnings: [] },
      {
        refresh,
        select,
        workspaces: [
          { id: 'w1', repoId: 'r1', hostId: 'h1', sandboxPath: '~/repos/api' },
          { id: 'w2', repoId: 'r1', hostId: 'h1', sandboxPath: '~/repos/api2' }
        ]
      }
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Remove workspace' })
    expect(within(dialog).queryByLabelText('ลบ mirror ด้วยไหม?')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(api.workspaces.remove).toHaveBeenCalledWith('w1', false)
    expect(select).not.toHaveBeenCalled()
  })
})
