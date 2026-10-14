import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import type { BranchInfo, FileChange, HostStatus } from '../../src/shared/types'

type Handler = (...args: unknown[]) => void
const handlers: Record<string, Handler> = {}

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    on: vi.fn((ev: string, cb: Handler) => {
      handlers[ev] = cb
      return () => undefined
    }),
    hosts: { connect: vi.fn() },
    workspaces: {
      branches: vi.fn(),
      baseBranches: vi.fn(),
      commits: vi.fn(),
      files: vi.fn(),
      diff: vi.fn(),
      worktrees: vi.fn(),
      push: vi.fn(),
      openPR: vi.fn(),
      rebuildMirror: vi.fn()
    },
    terminal: { open: vi.fn() }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { WorkspaceScreen } from '../../src/renderer/src/components/WorkspaceScreen'
import { ChangesPane } from '../../src/renderer/src/components/ChangesPane'
import { Toaster } from '../../src/renderer/src/components/Toaster'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

const branch = (over: Partial<BranchInfo> = {}): BranchInfo => ({
  name: 'feat/a',
  sha: 'abc',
  base: 'origin/main',
  ahead: 2,
  behind: 0,
  merged: false,
  rewritten: false,
  ...over
})

const file = (path: string, over: Partial<FileChange> = {}): FileChange => ({
  path,
  status: 'M',
  additions: 1,
  deletions: 0,
  ...over
})

const commit = { sha: 'abcdef1234', subject: 'add thing', author: 'me', date: '2026-01-01' }
const up: HostStatus = { state: 'connected' }
const setStatus = vi.fn()

function renderScreen(status: HostStatus = up): void {
  const value: AppState = {
    hosts: [{ id: 'h1', sshHost: 'box', label: 'Box', protected: false }],
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
    activeHostId: null,
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
    setStatus,
    refresh: vi.fn().mockResolvedValue(undefined)
  }
  render(
    <AppStateContext.Provider value={value}>
      <WorkspaceScreen workspaceId="w1" />
    </AppStateContext.Provider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  for (const k of Object.keys(handlers)) delete handlers[k]
  vi.mocked(api.workspaces.branches).mockResolvedValue([branch(), branch({ name: 'fix/b' })])
  vi.mocked(api.workspaces.worktrees).mockResolvedValue([])
  vi.mocked(api.workspaces.baseBranches).mockResolvedValue([
    { name: 'main', sha: 'main-sha' },
    { name: 'dev-v9', sha: 'v9-sha' }
  ])
  vi.mocked(api.workspaces.commits).mockResolvedValue([commit])
  vi.mocked(api.workspaces.files).mockResolvedValue([file('a.ts'), file('b.ts')])
  vi.mocked(api.workspaces.diff).mockImplementation(async (_i, _b, opts) => `+${opts?.file}-diff`)
  vi.mocked(api.terminal.open).mockResolvedValue({ tabId: 't1', label: 'x' })
})

async function chooseBase(name: string): Promise<void> {
  const input = await screen.findByRole('combobox', { name: 'Compare against branch' })
  fireEvent.input(input, { target: { value: name }, inputType: 'insertText' })
  fireEvent.click(await screen.findByRole('option', { name }))
}

describe('WorkspaceScreen selection', () => {
  it('selects a searched branch with the keyboard', async () => {
    renderScreen()
    fireEvent.click(await screen.findByText('feat/a'))
    const input = screen.getByRole('combobox', { name: 'Compare against branch' })
    act(() => input.focus())
    fireEvent.input(input, { target: { value: 'dev-v' }, inputType: 'insertText' })
    await screen.findByRole('option', { name: 'dev-v9' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(input).toHaveValue('dev-v9'))
    await waitFor(() =>
      expect(api.workspaces.commits).toHaveBeenLastCalledWith('w1', 'feat/a', 'dev-v9')
    )
  })

  it('searches origin branches and only compares after choosing a result', async () => {
    renderScreen()
    fireEvent.click(await screen.findByText('feat/a'))
    await screen.findByText('+a.ts-diff')
    const input = screen.getByRole('combobox', { name: 'Compare against branch' })
    fireEvent.input(input, { target: { value: 'DEV-V' }, inputType: 'insertText' })
    expect(await screen.findByRole('option', { name: 'dev-v9' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'main' })).toBeNull()
    expect(api.workspaces.commits).toHaveBeenLastCalledWith('w1', 'feat/a')
    fireEvent.click(screen.getByRole('option', { name: 'dev-v9' }))
    await waitFor(() => expect(input).toHaveValue('dev-v9'))
    await waitFor(() =>
      expect(api.workspaces.commits).toHaveBeenLastCalledWith('w1', 'feat/a', 'dev-v9')
    )
    expect(screen.queryByRole('listbox', { name: 'Origin branches' })).toBeNull()
  })

  it('shows an empty search and Escape restores the selected comparison', async () => {
    renderScreen()
    fireEvent.click(await screen.findByText('feat/a'))
    const input = screen.getByRole('combobox', { name: 'Compare against branch' })
    fireEvent.input(input, { target: { value: 'unknown-branch' }, inputType: 'insertText' })
    expect(await screen.findByText('No branches found.')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(input).toHaveValue('main'))
    expect(api.workspaces.commits).not.toHaveBeenCalledWith('w1', 'feat/a', 'unknown-branch')
  })

  it('returns to the comparison when sync moves the base past the selected commit', async () => {
    renderScreen()
    fireEvent.click(await screen.findByText('feat/a'))
    fireEvent.click(await screen.findByText('add thing'))
    await waitFor(() =>
      expect(api.workspaces.diff).toHaveBeenCalledWith('w1', 'feat/a', {
        commit: 'abcdef1234',
        file: 'a.ts'
      })
    )
    vi.mocked(api.workspaces.commits).mockResolvedValue([])
    vi.mocked(api.workspaces.files).mockImplementation(async (_id, _branch, sha) => {
      if (sha) throw new Error('Commit is not on this branch')
      return [file('remaining.ts')]
    })
    vi.mocked(api.workspaces.baseBranches).mockResolvedValue([
      { name: 'main', sha: 'advanced-main' }
    ])
    await act(async () => handlers['workspace-synced']('w1', { kind: 'full', at: 1 }))
    expect(await screen.findByText('+remaining.ts-diff')).toBeInTheDocument()
    expect(screen.queryByText('Commit is not on this branch')).toBeNull()
  })

  it('changes the comparison base in the header and resets the selected commit', async () => {
    renderScreen()
    fireEvent.click(await screen.findByText('feat/a'))
    fireEvent.click(await screen.findByText('add thing'))
    await screen.findByText('+a.ts-diff')
    vi.mocked(api.workspaces.commits).mockResolvedValue([
      { ...commit, sha: 'new-commit', subject: 'change since v9' }
    ])
    vi.mocked(api.workspaces.files).mockResolvedValue([file('since-v9.ts')])
    const select = screen.getByRole('combobox', { name: 'Compare against branch' })
    expect(select).toHaveValue('main')
    await chooseBase('dev-v9')
    expect(await screen.findByText('change since v9')).toBeInTheDocument()
    expect(await screen.findByText('+since-v9.ts-diff')).toBeInTheDocument()
    expect(screen.queryByText('add thing')).toBeNull()
    expect(api.workspaces.commits).toHaveBeenLastCalledWith('w1', 'feat/a', 'dev-v9')
    expect(api.workspaces.files).toHaveBeenLastCalledWith('w1', 'feat/a', undefined, 'dev-v9')
    expect(api.workspaces.diff).toHaveBeenLastCalledWith('w1', 'feat/a', {
      base: 'dev-v9',
      file: 'since-v9.ts'
    })
    expect(screen.getByLabelText('Target branch')).toHaveValue('feat/a')
  })

  it('ignores a late diff response from the previous comparison base', async () => {
    let finishOldDiff: (text: string) => void = () => undefined
    vi.mocked(api.workspaces.diff).mockImplementation((_id, _branch, opts) =>
      opts?.base === 'dev-v9'
        ? Promise.resolve('+new comparison')
        : new Promise<string>((resolve) => {
            finishOldDiff = resolve
          })
    )
    renderScreen()
    fireEvent.click(await screen.findByText('feat/a'))
    await waitFor(() => expect(api.workspaces.diff).toHaveBeenCalled())
    await chooseBase('dev-v9')
    expect(await screen.findByText('+new comparison')).toBeInTheDocument()
    await act(async () => finishOldDiff('+stale comparison'))
    expect(screen.queryByText('+stale comparison')).toBeNull()
    expect(screen.getByText('+new comparison')).toBeInTheDocument()
  })

  it('refreshes when the selected origin branch moves and falls back if it is deleted', async () => {
    renderScreen()
    fireEvent.click(await screen.findByText('feat/a'))
    await chooseBase('dev-v9')
    await screen.findByText('+a.ts-diff')
    vi.mocked(api.workspaces.files).mockResolvedValue([file('after-sync.ts')])
    vi.mocked(api.workspaces.baseBranches).mockResolvedValue([
      { name: 'main', sha: 'main-sha' },
      { name: 'dev-v9', sha: 'new-v9-sha' }
    ])
    await act(async () => handlers['workspace-synced']('w1', { kind: 'full', at: 1 }))
    expect(await screen.findByText('+after-sync.ts-diff')).toBeInTheDocument()
    vi.mocked(api.workspaces.baseBranches).mockResolvedValue([{ name: 'main', sha: 'main-sha' }])
    await act(async () => handlers['workspace-synced']('w1', { kind: 'full', at: 2 }))
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Compare against branch' })).toHaveValue('main')
    )
    await waitFor(() => expect(api.workspaces.commits).toHaveBeenLastCalledWith('w1', 'feat/a'))
  })

  it('branch click loads commits and files and shows the first file diff', async () => {
    renderScreen()
    fireEvent.click(await screen.findByText('feat/a'))
    expect(await screen.findByText('add thing')).toBeInTheDocument()
    expect(await screen.findByText('b.ts')).toBeInTheDocument()
    await waitFor(() =>
      expect(api.workspaces.diff).toHaveBeenCalledWith('w1', 'feat/a', { file: 'a.ts' })
    )
    expect(await screen.findByText('+a.ts-diff')).toBeInTheDocument()
    fireEvent.click(screen.getByText('b.ts'))
    expect(await screen.findByText('+b.ts-diff')).toBeInTheDocument()
    expect(api.workspaces.diff).toHaveBeenLastCalledWith('w1', 'feat/a', { file: 'b.ts' })
  })

  it('commit click filters files and diff, second click goes back to the branch', async () => {
    renderScreen()
    fireEvent.click(await screen.findByText('feat/a'))
    fireEvent.click(await screen.findByText('add thing'))
    await waitFor(() =>
      expect(api.workspaces.files).toHaveBeenCalledWith('w1', 'feat/a', 'abcdef1234')
    )
    await waitFor(() =>
      expect(api.workspaces.diff).toHaveBeenCalledWith('w1', 'feat/a', {
        commit: 'abcdef1234',
        file: 'a.ts'
      })
    )
    vi.mocked(api.workspaces.diff).mockClear()
    fireEvent.click(screen.getByText('add thing'))
    await waitFor(() =>
      expect(api.workspaces.diff).toHaveBeenCalledWith('w1', 'feat/a', { file: 'a.ts' })
    )
  })

  it('ignores stale responses', async () => {
    let resolveA: (f: FileChange[]) => void = () => undefined
    vi.mocked(api.workspaces.files).mockImplementation((_i, b) =>
      b === 'feat/a'
        ? new Promise<FileChange[]>((r) => {
            resolveA = r
          })
        : Promise.resolve([file('only-b.ts')])
    )
    renderScreen()
    fireEvent.click(await screen.findByText('feat/a'))
    fireEvent.click(screen.getByText('fix/b'))
    expect(await screen.findByText('only-b.ts')).toBeInTheDocument()
    await act(async () => resolveA([file('only-a.ts')]))
    expect(screen.queryByText('only-a.ts')).toBeNull()
    expect(screen.getAllByText('only-b.ts').length).toBeGreaterThan(0)
  })

  it('clears selection when the branch vanishes after a sync', async () => {
    renderScreen()
    fireEvent.click(await screen.findByText('feat/a'))
    await screen.findByText('b.ts')
    vi.mocked(api.workspaces.branches).mockResolvedValue([branch({ name: 'fix/b' })])
    await act(async () => handlers['workspace-synced']('w1', { kind: 'full', at: 1 }))
    expect(await screen.findByText('Select a branch on the left')).toBeInTheDocument()
    expect(screen.queryByText('b.ts')).toBeNull()
    expect(document.querySelector('.error')).toBeNull()
  })

  it('keeps the selected file when the branch sha changes on sync', async () => {
    renderScreen()
    fireEvent.click(await screen.findByText('feat/a'))
    fireEvent.click(await screen.findByText('b.ts'))
    await screen.findByText('+b.ts-diff')
    vi.mocked(api.workspaces.branches).mockResolvedValue([
      branch({ sha: 'new' }),
      branch({ name: 'fix/b' })
    ])
    await act(async () => handlers['workspace-synced']('w1', { kind: 'full', at: 1 }))
    await waitFor(() => expect(api.workspaces.files).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(api.workspaces.diff).toHaveBeenLastCalledWith('w1', 'feat/a', { file: 'b.ts' })
    )
  })

  it('arrow keys move the branch selection', async () => {
    renderScreen()
    const list = await screen.findByRole('listbox', { name: 'Branches' })
    await screen.findByText('feat/a')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    await waitFor(() => expect(api.workspaces.commits).toHaveBeenCalledWith('w1', 'feat/a'))
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    await waitFor(() => expect(api.workspaces.commits).toHaveBeenCalledWith('w1', 'fix/b'))
  })
})

describe('WorkspaceScreen branch list', () => {
  it('shows ahead/behind and badges, and the new marker clears once seen', async () => {
    renderScreen()
    await screen.findByText('feat/a')
    expect(screen.queryByLabelText('New')).toBeNull()
    vi.mocked(api.workspaces.branches).mockResolvedValue([
      branch({ sha: 'changed', behind: 1, rewritten: true }),
      branch({ name: 'fix/b', merged: true, ahead: 0 })
    ])
    await act(async () => handlers['workspace-synced']('w1', { kind: 'full', at: 1 }))
    expect(await screen.findByLabelText('New')).toBeInTheDocument()
    expect(screen.getByText('↑2')).toBeInTheDocument()
    expect(screen.getByText('↓1')).toBeInTheDocument()
    expect(screen.getByText('merged')).toBeInTheDocument()
    expect(screen.getByText('⚠ rewritten')).toBeInTheDocument()
    fireEvent.click(screen.getByText('feat/a'))
    await waitFor(() => expect(screen.queryByLabelText('New')).toBeNull())
  })

  it('lists worktrees and opens a terminal at that path', async () => {
    vi.mocked(api.workspaces.worktrees).mockResolvedValue([
      { path: '/home/dev/wt-x', branch: null, head: 'abc', dirty: 2 }
    ])
    renderScreen()
    expect(await screen.findByText('wt-x')).toBeInTheDocument()
    expect(screen.getByText('detached')).toBeInTheDocument()
    expect(screen.getByText('2✎')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open terminal in wt-x' }))
    await waitFor(() => expect(api.terminal.open).toHaveBeenCalledWith('w1', '/home/dev/wt-x'))
  })

  it('shows the empty message for a branch with no new commits', async () => {
    vi.mocked(api.workspaces.branches).mockResolvedValue([branch({ ahead: 0 })])
    vi.mocked(api.workspaces.commits).mockResolvedValue([])
    vi.mocked(api.workspaces.files).mockResolvedValue([])
    renderScreen()
    fireEvent.click(await screen.findByText('feat/a'))
    expect(await screen.findByText('No new commits compared to base')).toBeInTheDocument()
  })
})

describe('WorkspaceScreen disconnected', () => {
  it('shows the banner, disables Push and worktree-free branch list stays', async () => {
    renderScreen({ state: 'disconnected' })
    expect(await screen.findByText('feat/a')).toBeInTheDocument()
    expect(screen.getByText(/is not connected/)).toBeInTheDocument()
    expect(api.workspaces.worktrees).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('feat/a'))
    const push = await screen.findByRole('button', { name: 'Push to GitHub' })
    expect(push).toBeDisabled()
    expect(push).toHaveAttribute('title')
  })

  it('banner Connect connects the host', async () => {
    vi.mocked(api.hosts.connect).mockResolvedValue(up)
    renderScreen({ state: 'disconnected' })
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(api.hosts.connect).toHaveBeenCalledWith('h1'))
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('h1', up))
  })
})

describe('WorkspaceScreen push bar (moved from ReviewView)', () => {
  async function select(b = 'feat/a'): Promise<void> {
    fireEvent.click(await screen.findByText(b))
    await screen.findByLabelText('Target branch')
  }

  it('defaults target to the branch name and pushes with it', async () => {
    vi.mocked(api.workspaces.push).mockResolvedValue({ ok: true })
    renderScreen()
    await select()
    expect(screen.getByLabelText('Target branch')).toHaveValue('feat/a')
    fireEvent.click(screen.getByRole('button', { name: 'Push to GitHub' }))
    await waitFor(() => expect(api.workspaces.push).toHaveBeenCalledWith('w1', 'feat/a', 'feat/a'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open PR' })).toBeEnabled())
  })

  it('announces a successful push with a toast', async () => {
    vi.mocked(api.workspaces.push).mockResolvedValue({ ok: true })
    render(<Toaster />)
    renderScreen()
    await select()
    fireEvent.click(screen.getByRole('button', { name: 'Push to GitHub' }))
    // The toast store is module-level, so earlier pushes may still be queued; check the newest.
    const toast = (await screen.findAllByRole('status')).at(-1)!
    expect(toast).toHaveTextContent('Pushed')
    expect(toast).toHaveTextContent('feat/a → origin/feat/a')
    fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss notification' }))
    await waitFor(() => expect(toast).not.toBeInTheDocument())
  })

  it('toasts a non-fast-forward message verbatim and keeps Open PR disabled', async () => {
    const message = 'rejected: non-fast-forward'
    vi.mocked(api.workspaces.push).mockResolvedValue({
      ok: false,
      reason: 'non-fast-forward',
      message
    })
    render(<Toaster />)
    renderScreen()
    await select()
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Push to GitHub' }))
    const toast = await screen.findByRole('alert')
    expect(toast).toHaveTextContent('Push failed')
    expect(toast).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeDisabled()
  })

  it('Open PR is enabled when the branch is already on origin/<target>', async () => {
    vi.mocked(api.workspaces.branches).mockResolvedValue([branch({ base: 'origin/feat/a' })])
    vi.mocked(api.workspaces.openPR).mockResolvedValue(undefined)
    renderScreen()
    await select()
    fireEvent.click(screen.getByRole('button', { name: 'Open PR' }))
    await waitFor(() => expect(api.workspaces.openPR).toHaveBeenCalledWith('w1', 'feat/a'))
  })

  it('editing the target after a push disables Open PR again', async () => {
    vi.mocked(api.workspaces.push).mockResolvedValue({ ok: true })
    renderScreen()
    await select()
    fireEvent.click(screen.getByRole('button', { name: 'Push to GitHub' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open PR' })).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Target branch'), { target: { value: 'other' } })
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Target branch'), { target: { value: 'feat/a' } })
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeEnabled()
  })

  it('warns when history was rewritten, and not otherwise', async () => {
    vi.mocked(api.workspaces.branches).mockResolvedValue([
      branch({ rewritten: true }),
      branch({ name: 'fix/b' })
    ])
    renderScreen()
    await select()
    expect(screen.getByText(/history rewritten/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('fix/b'))
    await waitFor(() => expect(screen.queryByText(/history rewritten/)).toBeNull())
  })
})

describe('WorkspaceScreen errors (moved from WorkspaceView)', () => {
  it('git error shows Rebuild mirror which calls the API and reloads', async () => {
    vi.mocked(api.workspaces.branches).mockRejectedValueOnce(new Error('fatal: bad object'))
    vi.mocked(api.workspaces.rebuildMirror).mockResolvedValue(undefined)
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: 'Rebuild mirror' }))
    await waitFor(() => expect(api.workspaces.rebuildMirror).toHaveBeenCalledWith('r1', 'w1'))
    await waitFor(() => expect(api.workspaces.branches).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('fix/b')).toBeInTheDocument()
  })

  it('a non-git error has no Rebuild mirror button', async () => {
    vi.mocked(api.workspaces.branches).mockRejectedValue(new Error('timeout'))
    renderScreen()
    expect(await screen.findByText('timeout')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rebuild mirror' })).toBeNull()
  })
})

describe('ChangesPane push bar isolation', () => {
  it('does not carry pushed state to a same-named branch in another workspace', async () => {
    vi.mocked(api.workspaces.push).mockResolvedValue({ ok: true })
    const props = {
      branch: branch(),
      commits: [],
      files: [],
      commit: null,
      file: null,
      connected: true,
      error: null,
      onSelectCommit: vi.fn(),
      onSelectFile: vi.fn(),
      onRebuild: vi.fn()
    }
    const { rerender } = render(<ChangesPane workspaceId="w1" {...props} />)
    fireEvent.change(screen.getByLabelText('Target branch'), { target: { value: 'custom' } })
    fireEvent.click(screen.getByRole('button', { name: 'Push to GitHub' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open PR' })).toBeEnabled())
    rerender(<ChangesPane workspaceId="w2" {...props} />)
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeDisabled()
    expect(screen.getByLabelText('Target branch')).toHaveValue('feat/a')
  })
})

describe('ChangesPane file list identity', () => {
  it('swaps the file rows at once when the branch changes, without exit animation', () => {
    const props = {
      commits: [commit],
      commit: null,
      file: null,
      connected: true,
      error: null,
      onSelectCommit: vi.fn(),
      onSelectFile: vi.fn(),
      onRebuild: vi.fn()
    }
    const { rerender } = render(
      <ChangesPane workspaceId="w1" branch={branch()} files={[file('old.ts')]} {...props} />
    )
    expect(screen.getByText('old.ts')).toBeInTheDocument()
    rerender(
      <ChangesPane
        workspaceId="w1"
        branch={branch({ name: 'fix/b' })}
        files={[file('new.ts')]}
        {...props}
      />
    )
    expect(screen.getByText('new.ts')).toBeInTheDocument()
    expect(screen.queryByText('old.ts')).toBeNull()
  })
})

describe('WorkspaceScreen connection banner states', () => {
  it('disables the button while connecting', async () => {
    renderScreen({ state: 'connecting' })
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeDisabled()
  })

  it('offers Retry with the error text when the connection failed', async () => {
    renderScreen({ state: 'error', error: 'ssh: timeout' })
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(screen.getByText('ssh: timeout')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
  })
})
