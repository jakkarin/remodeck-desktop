import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { Workspace } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    hosts: { list: vi.fn(), status: vi.fn() },
    repos: { list: vi.fn() },
    workspaces: { list: vi.fn(), remove: vi.fn(), setActive: vi.fn() },
    on: vi.fn()
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { AppStateProvider, useAppState } from '../../src/renderer/src/state'
import { RemoveWorkspaceDialog } from '../../src/renderer/src/components/RemoveDialogs'

const w = (id: string): Workspace => ({
  id,
  repoId: `r${id}`,
  hostId: 'h1',
  sandboxPath: `~/${id}`
})

function Probe(): React.JSX.Element {
  const { activeWorkspaceId, workspaces, selectWorkspace } = useAppState()
  const first = workspaces[0]
  return (
    <div>
      <span data-testid="active">{String(activeWorkspaceId)}</span>
      <button onClick={() => selectWorkspace('w2')}>pick w2</button>
      {first && activeWorkspaceId === first.id && (
        <RemoveWorkspaceDialog workspace={first} label="one" onClose={() => undefined} />
      )}
    </div>
  )
}

function mount(): void {
  render(
    <AppStateProvider>
      <Probe />
    </AppStateProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.on).mockReturnValue(() => undefined)
  vi.mocked(api.hosts.list).mockResolvedValue([])
  vi.mocked(api.hosts.status).mockResolvedValue({ state: 'connected', warnings: [] })
  vi.mocked(api.repos.list).mockResolvedValue([])
})

describe('AppStateProvider', () => {
  it('selects the first workspace on first load and informs main', async () => {
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w1'), w('w2')])
    mount()
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('w1'))
    expect(api.workspaces.setActive).toHaveBeenCalledWith('w1')
  })

  it('selecting a workspace calls setActive', async () => {
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w1'), w('w2')])
    mount()
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('w1'))
    fireEvent.click(screen.getByRole('button', { name: 'pick w2' }))
    expect(screen.getByTestId('active')).toHaveTextContent('w2')
    expect(api.workspaces.setActive).toHaveBeenLastCalledWith('w2')
  })

  it('removing the active workspace selects the next one', async () => {
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w1'), w('w2')])
    vi.mocked(api.workspaces.remove).mockResolvedValue(undefined)
    mount()
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('w1'))
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w2')])
    const dialog = await screen.findByRole('dialog', { name: 'Remove workspace' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('w2'))
  })

  it('removing the last workspace selects null', async () => {
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w1')])
    vi.mocked(api.workspaces.remove).mockResolvedValue(undefined)
    mount()
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('w1'))
    vi.mocked(api.workspaces.list).mockResolvedValue([])
    const dialog = await screen.findByRole('dialog', { name: 'Remove workspace' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('null'))
  })
})
