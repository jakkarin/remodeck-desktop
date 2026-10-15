import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    repos: { listGitHub: vi.fn() },
    workspaces: { clone: vi.fn() },
    dialogs: { pickFolder: vi.fn() },
    on: vi.fn()
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { act } from 'react'
import type { CloneProgress, Workspace } from '../../src/shared/types'
import { api } from '../../src/renderer/src/api'
import { CloneDialog } from '../../src/renderer/src/components/CloneDialog'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

function renderDialog(hostIds: string[], onCloned: (w: Workspace) => void): void {
  const value = {
    hosts: [
      { id: 'h1', sshHost: 'a', label: 'Alpha', protected: false },
      { id: 'h2', sshHost: 'b', label: 'Beta', protected: false }
    ]
  } as unknown as AppState
  render(
    <AppStateContext.Provider value={value}>
      <CloneDialog hostIds={hostIds} onClose={vi.fn()} onCloned={onCloned} />
    </AppStateContext.Provider>
  )
}

const ws = (id: string, path: string): Workspace => ({
  id,
  repoId: 'r',
  hostId: 'h1',
  sandboxPath: path
})

let progressListener: ((hostId: string, path: string, p: CloneProgress) => void) | null = null

beforeEach(() => {
  vi.clearAllMocks()
  progressListener = null
  vi.mocked(api.on).mockImplementation(((event: string, cb: never) => {
    if (event === 'clone-progress') progressListener = cb
    return () => {
      progressListener = null
    }
  }) as typeof api.on)
  vi.mocked(api.repos.listGitHub).mockResolvedValue([
    { owner: 'acme', name: 'api', defaultBranch: 'main' }
  ])
})

describe('CloneDialog', () => {
  it('picking a repo sets the default path and submit clones', async () => {
    const onCloned = vi.fn()
    vi.mocked(api.workspaces.clone).mockResolvedValue(ws('w1', '~/repos/api'))
    renderDialog(['h1'], onCloned)
    fireEvent.click(await screen.findByRole('option', { name: 'acme/api' }))
    expect(screen.getByLabelText('Path')).toHaveValue('~/repos/api')
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))
    await waitFor(() =>
      expect(api.workspaces.clone).toHaveBeenCalledWith('h1', 'acme/api', '~/repos/api')
    )
    await waitFor(() =>
      expect(onCloned).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1' }))
    )
  })

  it('renders the rejection message', async () => {
    vi.mocked(api.workspaces.clone).mockRejectedValue(new Error('clone failed'))
    renderDialog(['h1'], vi.fn())
    fireEvent.click(await screen.findByRole('option', { name: 'acme/api' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))
    expect(await screen.findByText('clone failed')).toBeInTheDocument()
  })

  it('shows the list error but still accepts free text', async () => {
    vi.mocked(api.repos.listGitHub).mockRejectedValue(new Error('gh unavailable'))
    vi.mocked(api.workspaces.clone).mockResolvedValue(ws('w2', '~/repos/web'))
    renderDialog(['h1'], vi.fn())
    expect(await screen.findByText(/gh unavailable/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'acme/web' } })
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '~/repos/web' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))
    await waitFor(() =>
      expect(api.workspaces.clone).toHaveBeenCalledWith('h1', 'acme/web', '~/repos/web')
    )
  })

  it('typing a repo fills the default path until the user edits it', async () => {
    renderDialog(['h1'], vi.fn())
    fireEvent.click(screen.getByRole('tab', { name: 'URL' }))
    const repoField = screen.getByLabelText('Repository')
    const pathField = screen.getByLabelText('Path')
    fireEvent.change(repoField, { target: { value: 'https://github.com/acme/web.git' } })
    expect(pathField).toHaveValue('~/repos/web')
    fireEvent.change(repoField, { target: { value: 'acme/other' } })
    expect(pathField).toHaveValue('~/repos/other')
    fireEvent.change(repoField, { target: { value: 'not a repo' } })
    expect(pathField).toHaveValue('~/repos/other')
    fireEvent.change(pathField, { target: { value: '/srv/mine' } })
    fireEvent.change(repoField, { target: { value: 'acme/api' } })
    expect(pathField).toHaveValue('/srv/mine')
  })
})

describe('CloneDialog progress', () => {
  it('shows the percentage for this clone only and stops listening when done', async () => {
    let finish: (w: Workspace) => void = () => {}
    vi.mocked(api.workspaces.clone).mockReturnValue(new Promise((r) => (finish = r)))
    renderDialog(['h1'], vi.fn())
    fireEvent.click(await screen.findByRole('option', { name: 'acme/api' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))
    const bar = await screen.findByRole('progressbar', { name: 'Clone progress' })
    expect(bar).toHaveAttribute('aria-valuenow', '0')
    act(() => progressListener?.('h1', '~/repos/api', { phase: 'fetch', percent: 42 }))
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByText('Fetching from GitHub…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cloning 42%' })).toBeDisabled()
    act(() => progressListener?.('h2', '~/repos/api', { phase: 'push', percent: 90 }))
    act(() => progressListener?.('h1', '~/repos/other', { phase: 'push', percent: 90 }))
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    await act(async () => finish(ws('w1', '~/repos/api')))
    expect(progressListener).toBeNull()
  })
})

describe('CloneDialog repo list', () => {
  const twoRepos = (): void => {
    vi.mocked(api.repos.listGitHub).mockResolvedValue([
      { owner: 'acme', name: 'api', defaultBranch: 'main' },
      { owner: 'acme', name: 'web', defaultBranch: 'main' }
    ])
  }

  it('filters the list and picks with the arrow keys', async () => {
    twoRepos()
    renderDialog(['h1'], vi.fn())
    await screen.findByRole('option', { name: 'acme/web' })
    const filter = screen.getByLabelText('Filter repositories')
    fireEvent.change(filter, { target: { value: 'WE' } })
    expect(screen.queryByRole('option', { name: 'acme/api' })).toBeNull()
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: 'acme/web' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    expect(screen.getByLabelText('Path')).toHaveValue('~/repos/web')
    fireEvent.change(filter, { target: { value: 'nope' } })
    expect(screen.getByText('No repositories match "nope".')).toBeInTheDocument()
  })

  it('Enter in the filter clones the picked repo', async () => {
    twoRepos()
    vi.mocked(api.workspaces.clone).mockResolvedValue(ws('w1', '~/repos/api'))
    renderDialog(['h1'], vi.fn())
    await screen.findByRole('option', { name: 'acme/api' })
    const filter = screen.getByLabelText('Filter repositories')
    fireEvent.keyDown(filter, { key: 'Enter' })
    expect(api.workspaces.clone).not.toHaveBeenCalled()
    fireEvent.keyDown(filter, { key: 'ArrowDown' })
    fireEvent.keyDown(filter, { key: 'Enter' })
    await waitFor(() =>
      expect(api.workspaces.clone).toHaveBeenCalledWith('h1', 'acme/api', '~/repos/api')
    )
  })

  it('refresh reloads the list', async () => {
    twoRepos()
    renderDialog(['h1'], vi.fn())
    await screen.findByRole('option', { name: 'acme/api' })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh repositories' }))
    await screen.findByRole('option', { name: 'acme/api' })
    expect(api.repos.listGitHub).toHaveBeenCalledTimes(2)
  })

  it('switching to URL clears a picked repo', async () => {
    renderDialog(['h1'], vi.fn())
    fireEvent.click(await screen.findByRole('option', { name: 'acme/api' }))
    fireEvent.click(screen.getByRole('tab', { name: 'URL' }))
    expect(screen.getByLabelText('Repository')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Clone' })).toBeDisabled()
  })
})

describe('CloneDialog host choice', () => {
  it('shows no host select for a single host', () => {
    renderDialog(['h1'], vi.fn())
    expect(screen.queryByLabelText('Host')).toBeNull()
  })

  it('clones on the chosen host when there are several', async () => {
    vi.mocked(api.workspaces.clone).mockResolvedValue(ws('w3', '~/repos/api'))
    renderDialog(['h1', 'h2'], vi.fn())
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'h2' } })
    fireEvent.click(screen.getByRole('tab', { name: 'URL' }))
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'acme/api' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))
    await waitFor(() =>
      expect(api.workspaces.clone).toHaveBeenCalledWith('h2', 'acme/api', '~/repos/api')
    )
  })
})

describe('CloneDialog folder picker', () => {
  const renderLocal = (hostIds = ['local']): void => {
    const value = {
      hosts: [
        { id: 'local', kind: 'local', sshHost: '', label: 'This computer', protected: false },
        { id: 'h1', sshHost: 'a', label: 'Alpha', protected: false }
      ]
    } as unknown as AppState
    render(
      <AppStateContext.Provider value={value}>
        <CloneDialog hostIds={hostIds} onClose={vi.fn()} onCloned={vi.fn()} />
      </AppStateContext.Provider>
    )
  }

  it('puts the repo inside the chosen parent folder on This computer', async () => {
    vi.mocked(api.dialogs.pickFolder).mockResolvedValue('D:/work')
    renderLocal()
    fireEvent.click(await screen.findByRole('option', { name: 'acme/api' }))
    fireEvent.click(screen.getByRole('button', { name: 'Browse for a folder' }))
    await waitFor(() => expect(screen.getByLabelText('Path')).toHaveValue('D:/work/api'))
    expect(api.dialogs.pickFolder).toHaveBeenCalledWith('~/repos')
  })

  it('keeps the chosen parent for a repo picked afterwards', async () => {
    vi.mocked(api.dialogs.pickFolder).mockResolvedValue('D:/work')
    renderLocal()
    fireEvent.click(screen.getByRole('button', { name: 'Browse for a folder' }))
    await waitFor(() => expect(screen.getByLabelText('Path')).toHaveValue('D:/work'))
    fireEvent.click(await screen.findByRole('option', { name: 'acme/api' }))
    expect(screen.getByLabelText('Path')).toHaveValue('D:/work/api')
  })

  it('leaves the path alone when the picker is cancelled', async () => {
    vi.mocked(api.dialogs.pickFolder).mockResolvedValue(null)
    renderLocal()
    fireEvent.click(await screen.findByRole('option', { name: 'acme/api' }))
    fireEvent.click(screen.getByRole('button', { name: 'Browse for a folder' }))
    await waitFor(() => expect(api.dialogs.pickFolder).toHaveBeenCalled())
    expect(screen.getByLabelText('Path')).toHaveValue('~/repos/api')
  })

  it('offers no folder picker for an SSH host', () => {
    renderLocal(['h1'])
    expect(screen.queryByRole('button', { name: 'Browse for a folder' })).not.toBeInTheDocument()
  })
})
