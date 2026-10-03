import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { HostStatus } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    hosts: { connect: vi.fn(), disconnect: vi.fn(), add: vi.fn() },
    repos: { listGitHub: vi.fn().mockResolvedValue([]) },
    workspaces: { clone: vi.fn() }
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
})
