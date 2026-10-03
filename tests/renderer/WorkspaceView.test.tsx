import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { BranchInfo, HostStatus } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    workspaces: {
      sync: vi.fn(),
      branches: vi.fn(),
      commits: vi.fn().mockResolvedValue([]),
      diff: vi.fn().mockResolvedValue(''),
      worktrees: vi.fn(),
      push: vi.fn(),
      openPR: vi.fn(),
      rebuildMirror: vi.fn()
    },
    terminal: { open: vi.fn().mockResolvedValue({ tabId: 't1', label: 'x' }) }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { WorkspaceView } from '../../src/renderer/src/components/WorkspaceView'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

const branch = (over: Partial<BranchInfo> = {}): BranchInfo => ({
  name: 'feat/a',
  sha: 'abc',
  base: 'origin/main',
  ahead: 2,
  behind: 1,
  merged: false,
  rewritten: false,
  ...over
})

function renderView(status: HostStatus): void {
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
    selected: { kind: 'workspace', id: 'w1' },
    select: vi.fn(),
    setStatus: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined)
  }
  render(
    <AppStateContext.Provider value={value}>
      <WorkspaceView workspaceId="w1" />
    </AppStateContext.Provider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.workspaces.worktrees).mockResolvedValue([])
})

describe('WorkspaceView', () => {
  it('disconnected: Sync disabled, branches still listed, header shown', async () => {
    vi.mocked(api.workspaces.branches).mockResolvedValue([branch()])
    renderView({ state: 'disconnected', warnings: [] })
    expect(screen.getByRole('button', { name: 'Sync' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open terminal' })).toBeDisabled()
    expect(await screen.findByText('feat/a')).toBeInTheDocument()
    expect(screen.getByText('acme/api @ Box:~/repos/api')).toBeInTheDocument()
    expect(api.workspaces.worktrees).not.toHaveBeenCalled()
  })

  it('shows merged and history rewritten badges', async () => {
    vi.mocked(api.workspaces.branches).mockResolvedValue([
      branch({ rewritten: true }),
      branch({ name: 'old', merged: true })
    ])
    renderView({ state: 'connected', warnings: [] })
    expect(await screen.findByText('history rewritten')).toBeInTheDocument()
    expect(screen.getByText('merged')).toBeInTheDocument()
  })

  it('sync reloads branches; connected lists worktrees with dirty count', async () => {
    vi.mocked(api.workspaces.branches).mockResolvedValue([branch()])
    vi.mocked(api.workspaces.sync).mockResolvedValue({ rewritten: [] })
    vi.mocked(api.workspaces.worktrees).mockResolvedValue([
      { path: '/wt/one', branch: 'feat/a', head: 'abc', dirty: 3 }
    ])
    renderView({ state: 'connected', warnings: [] })
    expect(await screen.findByText('/wt/one')).toBeInTheDocument()
    expect(screen.getByText('3 dirty')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    await waitFor(() => expect(api.workspaces.sync).toHaveBeenCalledWith('w1'))
    await waitFor(() => expect(api.workspaces.branches).toHaveBeenCalledTimes(2))
  })

  it('git error shows Rebuild mirror which calls the API', async () => {
    vi.mocked(api.workspaces.branches).mockRejectedValue(new Error('fatal: bad object'))
    vi.mocked(api.workspaces.rebuildMirror).mockResolvedValue(undefined)
    renderView({ state: 'connected', warnings: [] })
    const btn = await screen.findByRole('button', { name: 'Rebuild mirror' })
    fireEvent.click(btn)
    await waitFor(() => expect(api.workspaces.rebuildMirror).toHaveBeenCalledWith('r1'))
  })

  it('clicking a branch opens the review view', async () => {
    vi.mocked(api.workspaces.branches).mockResolvedValue([branch()])
    renderView({ state: 'connected', warnings: [] })
    fireEvent.click(await screen.findByText('feat/a'))
    expect(await screen.findByRole('button', { name: 'Push to GitHub' })).toBeInTheDocument()
  })
})
