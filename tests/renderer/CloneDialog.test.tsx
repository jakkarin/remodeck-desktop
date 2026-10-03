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
    render(<CloneDialog hostId="h1" onClose={vi.fn()} onCloned={onCloned} />)
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
    vi.mocked(api.workspaces.clone).mockRejectedValue(new Error('clone ล้มเหลว'))
    render(<CloneDialog hostId="h1" onClose={vi.fn()} onCloned={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'acme/api' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))
    expect(await screen.findByText('clone ล้มเหลว')).toBeInTheDocument()
  })

  it('shows the list error but still accepts free text', async () => {
    vi.mocked(api.repos.listGitHub).mockRejectedValue(new Error('gh ไม่พร้อม'))
    vi.mocked(api.workspaces.clone).mockResolvedValue(ws('w2', '~/repos/web'))
    render(<CloneDialog hostId="h1" onClose={vi.fn()} onCloned={vi.fn()} />)
    expect(await screen.findByText(/gh ไม่พร้อม/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'acme/web' } })
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '~/repos/web' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clone' }))
    await waitFor(() =>
      expect(api.workspaces.clone).toHaveBeenCalledWith('h1', 'acme/web', '~/repos/web')
    )
  })

  it('typing a repo fills the default path until the user edits it', async () => {
    render(<CloneDialog hostId="h1" onClose={vi.fn()} onCloned={vi.fn()} />)
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
