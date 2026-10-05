import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../src/renderer/src/api', () => ({
  api: { workspaces: { addExisting: vi.fn() } },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import type { Workspace } from '../../src/shared/types'
import { api } from '../../src/renderer/src/api'
import { AddExistingDialog } from '../../src/renderer/src/components/AddExistingDialog'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

function renderDialog(
  hostIds: string[],
  over: { onAdded?: (w: Workspace) => void; onClose?: () => void } = {}
): void {
  const value = {
    hosts: [
      { id: 'h1', sshHost: 'a', label: 'Alpha' },
      { id: 'h2', sshHost: 'b', label: 'Beta' }
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

beforeEach(() => vi.clearAllMocks())

describe('AddExistingDialog', () => {
  it('is titled "Add existing repo" with a path placeholder and a disabled submit until a path is typed', () => {
    renderDialog(['h1'])
    expect(screen.getByRole('dialog', { name: 'Add existing repo' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Add existing repo' })).toBeInTheDocument()
    expect(screen.getByLabelText('Path')).toHaveAttribute('placeholder', '~/work/my-app')
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('submits the trimmed path and reports the new workspace', async () => {
    const onAdded = vi.fn()
    vi.mocked(api.workspaces.addExisting).mockResolvedValue(ws('w1', '~/work/app'))
    renderDialog(['h1'], { onAdded })
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '  ~/work/app ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(api.workspaces.addExisting).toHaveBeenCalledWith('h1', '~/work/app'))
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1' })))
  })

  it('is busy while adding', async () => {
    let resolve: (w: Workspace) => void = () => {}
    vi.mocked(api.workspaces.addExisting).mockReturnValue(new Promise((r) => (resolve = r)))
    renderDialog(['h1'])
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '~/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByRole('button', { name: 'Adding...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByLabelText('Path')).toBeDisabled()
    resolve(ws('w9', '~/x'))
  })

  it('renders the rejection message and becomes usable again', async () => {
    vi.mocked(api.workspaces.addExisting).mockRejectedValue(new Error('ไม่ใช่ git repo: ~/x'))
    renderDialog(['h1'])
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '~/x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('ไม่ใช่ git repo: ~/x')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled()
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
    vi.mocked(api.workspaces.addExisting).mockResolvedValue(ws('w3', '~/work/app'))
    renderDialog(['h1', 'h2'])
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'h2' } })
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '~/work/app' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(api.workspaces.addExisting).toHaveBeenCalledWith('h2', '~/work/app'))
  })
})
