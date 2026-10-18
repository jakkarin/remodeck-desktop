import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    workspaces: { inspectExisting: vi.fn(), addExisting: vi.fn() },
    dialogs: { pickFolder: vi.fn() }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

const platform = vi.hoisted(() => ({ windows: true }))
vi.mock('../../src/renderer/src/platform', () => ({
  get isWindows() {
    return platform.windows
  }
}))

import type { ExistingRepoInfo, Workspace } from '../../src/shared/types'
import { api } from '../../src/renderer/src/api'
import { AddExistingDialog } from '../../src/renderer/src/components/AddExistingDialog'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

function renderDialog(
  hostIds: string[],
  over: { onAdded?: (w: Workspace) => void; onClose?: () => void } = {}
): void {
  const value = {
    hosts: [
      { id: 'h1', sshHost: 'a', label: 'Alpha', protected: false },
      { id: 'h2', sshHost: 'b', label: 'Beta', protected: false }
    ]
  } as unknown as AppState
  render(
    <AppStateContext.Provider value={value}>
      <AddExistingDialog
        hostIds={hostIds}
        onClose={over.onClose ?? vi.fn()}
        onAdded={over.onAdded ?? vi.fn()}
      />
    </AppStateContext.Provider>
  )
}

const ws = (id: string, path: string): Workspace => ({
  id,
  repoId: 'r',
  hostId: 'h1',
  sandboxPath: path
})

const info = (over: Partial<ExistingRepoInfo> = {}): ExistingRepoInfo => ({
  owner: 'o',
  name: 'r',
  known: true,
  alwaysAllowPush: false,
  ...over
})

async function check(path = '~/work/app', over: Partial<ExistingRepoInfo> = {}): Promise<void> {
  vi.mocked(api.workspaces.inspectExisting).mockResolvedValue(info(over))
  fireEvent.change(screen.getByLabelText('Path'), { target: { value: path } })
  fireEvent.click(screen.getByRole('button', { name: 'Check' }))
  await screen.findByRole('button', { name: 'Confirm & Add' })
}

beforeEach(() => vi.clearAllMocks())

describe('AddExistingDialog', () => {
  it('is titled "Add existing repo" with a path placeholder and a disabled Check until a path is typed', () => {
    renderDialog(['h1'])
    expect(screen.getByRole('dialog', { name: 'Add existing repo' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Add existing repo' })).toBeInTheDocument()
    expect(screen.getByLabelText('Path')).toHaveAttribute('placeholder', '~/work/my-app')
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled()
  })

  it('Check inspects the trimmed path and shows the resolved repo without adding anything', async () => {
    renderDialog(['h1'])
    await check('  ~/work/app ')
    expect(api.workspaces.inspectExisting).toHaveBeenCalledWith('h1', '~/work/app')
    expect(api.workspaces.addExisting).not.toHaveBeenCalled()
    expect(
      screen.getByText(/This workspace will be linked to github\.com\/o\/r/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/remodeck will fetch this repo with your GitHub credentials/)
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Path')).toBeDisabled()
  })

  it('renders owner/name as plain text, not markup', async () => {
    renderDialog(['h1'])
    await check('~/x', { owner: '<b>o</b>', name: 'r' })
    expect(screen.getByText(/github\.com\/<b>o<\/b>\/r/)).toBeInTheDocument()
    expect(screen.getByRole('dialog').querySelector('b')).toBeNull()
  })

  it('Confirm & Add calls addExisting with the confirmed owner/name and reports the workspace', async () => {
    const onAdded = vi.fn()
    vi.mocked(api.workspaces.addExisting).mockResolvedValue(ws('w1', '~/work/app'))
    renderDialog(['h1'], { onAdded })
    await check()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Add' }))
    await waitFor(() =>
      expect(api.workspaces.addExisting).toHaveBeenCalledWith('h1', '~/work/app', {
        owner: 'o',
        name: 'r'
      })
    )
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1' })))
  })

  it('warns when the repo is not yet known to remodeck', async () => {
    renderDialog(['h1'])
    await check('~/x', { known: false })
    expect(
      screen.getByText(
        'This repo has not been used in remodeck before — make sure it is the one you intend'
      )
    ).toBeInTheDocument()
  })

  it('shows no warnings for a known repo without Always allow push', async () => {
    renderDialog(['h1'])
    await check('~/x')
    expect(screen.queryByText(/has not been used in remodeck/)).toBeNull()
    expect(screen.queryByText(/Always allow push/)).toBeNull()
  })

  it('warns when the repo has Always allow push', async () => {
    renderDialog(['h1'])
    await check('~/x', { alwaysAllowPush: true })
    expect(
      screen.getByText(
        'This repo has Always allow push on — agents in the sandbox can push without approval'
      )
    ).toBeInTheDocument()
  })

  it('Back returns to step 1 keeping the path, and editing it never keeps a stale result', async () => {
    renderDialog(['h1'])
    await check()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Path')).toHaveValue('~/work/app')
    expect(screen.getByLabelText('Path')).toBeEnabled()
    expect(screen.queryByText(/will be linked to/)).toBeNull()
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '~/other' } })
    expect(screen.getByRole('button', { name: 'Check' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Confirm & Add' })).toBeNull()
  })

  it('changing the host invalidates the inspected result', async () => {
    renderDialog(['h1', 'h2'])
    await check()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'h2' } })
    expect(screen.queryByRole('button', { name: 'Confirm & Add' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Check' })).toBeInTheDocument()
  })

  it('is busy while checking', async () => {
    let resolve: (i: ExistingRepoInfo) => void = () => {}
    vi.mocked(api.workspaces.inspectExisting).mockReturnValue(new Promise((r) => (resolve = r)))
    renderDialog(['h1'])
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '~/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByRole('button', { name: 'Checking...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByLabelText('Path')).toBeDisabled()
    resolve(info())
    await screen.findByRole('button', { name: 'Confirm & Add' })
  })

  it('is busy while adding', async () => {
    let resolve: (w: Workspace) => void = () => {}
    vi.mocked(api.workspaces.addExisting).mockReturnValue(new Promise((r) => (resolve = r)))
    renderDialog(['h1'])
    await check('~/x')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Add' }))
    expect(await screen.findByRole('button', { name: 'Adding...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    resolve(ws('w9', '~/x'))
  })

  it('renders an inspect rejection and stays on step 1', async () => {
    vi.mocked(api.workspaces.inspectExisting).mockRejectedValue(new Error('Not a git repo: ~/x'))
    renderDialog(['h1'])
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '~/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('Not a git repo: ~/x')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check' })).toBeEnabled()
  })

  it('renders an add rejection and stays on step 2, usable again', async () => {
    vi.mocked(api.workspaces.addExisting).mockRejectedValue(new Error('repo origin changed'))
    renderDialog(['h1'])
    await check('~/x')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Add' }))
    expect(await screen.findByText('repo origin changed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm & Add' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
  })

  it('closes on Cancel and on Escape', () => {
    const onClose = vi.fn()
    renderDialog(['h1'], { onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('shows no host select for a single host', () => {
    renderDialog(['h1'])
    expect(screen.queryByLabelText('Host')).toBeNull()
  })

  it('uses the chosen host when there are several', async () => {
    renderDialog(['h1', 'h2'])
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'h2' } })
    await check()
    expect(api.workspaces.inspectExisting).toHaveBeenCalledWith('h2', '~/work/app')
  })
})

describe('AddExistingDialog on This computer', () => {
  it('suggests a drive path for the local host', () => {
    const value = {
      hosts: [{ id: 'local', kind: 'local', sshHost: '', label: 'This computer', protected: false }]
    } as unknown as AppState
    render(
      <AppStateContext.Provider value={value}>
        <AddExistingDialog hostIds={['local']} onClose={vi.fn()} onAdded={vi.fn()} />
      </AppStateContext.Provider>
    )
    expect(screen.getByLabelText('Path')).toHaveAttribute('placeholder', 'D:/projects/my-app')
  })

  it('suggests a home path for the local host off Windows', () => {
    platform.windows = false
    try {
      const value = {
        hosts: [
          { id: 'local', kind: 'local', sshHost: '', label: 'This computer', protected: false }
        ]
      } as unknown as AppState
      render(
        <AppStateContext.Provider value={value}>
          <AddExistingDialog hostIds={['local']} onClose={vi.fn()} onAdded={vi.fn()} />
        </AppStateContext.Provider>
      )
      expect(screen.getByLabelText('Path')).toHaveAttribute('placeholder', '~/work/my-app')
    } finally {
      platform.windows = true
    }
  })
})

describe('AddExistingDialog folder picker', () => {
  const renderLocal = (hostIds = ['local']): void => {
    const value = {
      hosts: [
        { id: 'local', kind: 'local', sshHost: '', label: 'This computer', protected: false },
        { id: 'h1', sshHost: 'a', label: 'Alpha', protected: false }
      ]
    } as unknown as AppState
    render(
      <AppStateContext.Provider value={value}>
        <AddExistingDialog hostIds={hostIds} onClose={vi.fn()} onAdded={vi.fn()} />
      </AppStateContext.Provider>
    )
  }

  it('fills the path from the folder picker on This computer, starting at the typed path', async () => {
    vi.mocked(api.dialogs.pickFolder).mockResolvedValue('D:/develop/app')
    renderLocal()
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: 'D:/develop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Browse for a folder' }))
    await waitFor(() => expect(screen.getByLabelText('Path')).toHaveValue('D:/develop/app'))
    expect(api.dialogs.pickFolder).toHaveBeenCalledWith('D:/develop')
    expect(screen.getByRole('button', { name: 'Check' })).toBeEnabled()
  })

  it('keeps the typed path when the picker is cancelled', async () => {
    vi.mocked(api.dialogs.pickFolder).mockResolvedValue(null)
    renderLocal()
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: 'D:/keep' } })
    fireEvent.click(screen.getByRole('button', { name: 'Browse for a folder' }))
    await waitFor(() => expect(api.dialogs.pickFolder).toHaveBeenCalled())
    expect(screen.getByLabelText('Path')).toHaveValue('D:/keep')
  })

  it('offers no folder picker for an SSH host', () => {
    renderLocal(['h1'])
    expect(screen.queryByRole('button', { name: 'Browse for a folder' })).not.toBeInTheDocument()
  })
})
