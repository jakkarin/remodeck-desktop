import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    repos: { listGitHub: vi.fn() },
    workspaces: { clone: vi.fn() }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import type { Workspace } from '../../src/shared/types'
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

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.repos.listGitHub).mockResolvedValue([
    { owner: 'acme', name: 'api', defaultBranch: 'main' }
  ])
})

describe('CloneDialog', () => {
  it('picking a repo sets the default path and submit clones', async () => {
    const onCloned = vi.fn()
    vi.mocked(api.workspaces.clone).mockResolvedValue(ws('w1', '~/repos/api'))
    renderDialog(['h1'], onCloned)
    fireEvent.click(await screen.findByRole('button', { name: 'acme/api' }))
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
    fireEvent.click(await screen.findByRole('button', { name: 'acme/api' }))
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

describe('CloneDialog host choice', () => {
  it('shows no host select for a single host', () => {
    renderDialog(['h1'], vi.fn())
    expect(screen.queryByLabelText('Host')).toBeNull()
  })

  it('clones on the chosen host when there are several', async () => {
    vi.mocked(api.workspaces.clone).mockResolvedValue(ws('w3', '~/repos/api'))
    renderDialog(['h1', 'h2'], vi.fn())
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'h2' } })
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'acme/api' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))
    await waitFor(() =>
      expect(api.workspaces.clone).toHaveBeenCalledWith('h2', 'acme/api', '~/repos/api')
    )
  })
})
