import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { BranchInfo } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    workspaces: {
      commits: vi.fn(),
      diff: vi.fn(),
      push: vi.fn(),
      openPR: vi.fn()
    }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { ReviewView } from '../../src/renderer/src/components/ReviewView'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

const branch = (over: Partial<BranchInfo> = {}): BranchInfo => ({
  name: 'feat/a',
  sha: 'abc',
  base: 'origin/main',
  ahead: 1,
  behind: 0,
  merged: false,
  rewritten: false,
  ...over
})

function renderView(b: BranchInfo, onBack = vi.fn()): void {
  const value: AppState = {
    hosts: [{ id: 'h1', sshHost: 'box', label: 'Box' }],
    statuses: {},
    repos: [],
    workspaces: [{ id: 'w1', repoId: 'r1', hostId: 'h1', sandboxPath: '~/repos/api' }],
    selected: { kind: 'workspace', id: 'w1' },
    select: vi.fn(),
    setStatus: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined)
  }
  render(
    <AppStateContext.Provider value={value}>
      <ReviewView workspaceId="w1" branch={b} onBack={onBack} />
    </AppStateContext.Provider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.workspaces.commits).mockResolvedValue([
    { sha: 'abcdef1234', subject: 'add thing', author: 'me', date: '2026-01-01' }
  ])
  vi.mocked(api.workspaces.diff).mockResolvedValue('@@ -1 +1 @@\n-old\n+new\n')
})

describe('ReviewView', () => {
  it('shows source, commits, coloured diff and defaults target to branch name', async () => {
    renderView(branch())
    expect(screen.getByText('จาก Box:~/repos/api')).toBeInTheDocument()
    expect(await screen.findByText('add thing')).toBeInTheDocument()
    expect((await screen.findByText('+new')).className).toContain('diff-add')
    expect(screen.getByText('-old').className).toContain('diff-del')
    expect(screen.getByLabelText('Target branch')).toHaveValue('feat/a')
  })

  it('push calls API with branch and target', async () => {
    vi.mocked(api.workspaces.push).mockResolvedValue({ ok: true })
    renderView(branch())
    fireEvent.click(screen.getByRole('button', { name: 'Push to GitHub' }))
    await waitFor(() => expect(api.workspaces.push).toHaveBeenCalledWith('w1', 'feat/a', 'feat/a'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open PR' })).toBeEnabled())
  })

  it('shows non-fast-forward message verbatim and keeps Open PR disabled', async () => {
    const message = 'ถูกปฏิเสธ: non-fast-forward'
    vi.mocked(api.workspaces.push).mockResolvedValue({
      ok: false,
      reason: 'non-fast-forward',
      message
    })
    renderView(branch())
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Push to GitHub' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeDisabled()
  })

  it('Open PR enabled when branch already on origin/<target>', async () => {
    vi.mocked(api.workspaces.openPR).mockResolvedValue(undefined)
    renderView(branch({ base: 'origin/feat/a' }))
    const btn = screen.getByRole('button', { name: 'Open PR' })
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    await waitFor(() => expect(api.workspaces.openPR).toHaveBeenCalledWith('w1', 'feat/a'))
  })

  it('Back calls onBack', () => {
    const onBack = vi.fn()
    renderView(branch(), onBack)
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
  })
})
