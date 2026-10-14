import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Host } from '../../src/shared/types'
import type { BuildRecord } from '../../src/shared/builds'

vi.mock('../../src/renderer/src/api', () => ({
  api: { containers: { buildHistory: vi.fn(), openTerminal: vi.fn() } },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))
import { api } from '../../src/renderer/src/api'
import { BuildsView } from '../../src/renderer/src/components/BuildsView'
import { onTerminalOpened } from '../../src/renderer/src/terminalEvents'

const host: Host = { id: 'h1', sshHost: 'box', label: 'Box', protected: false }
const build: BuildRecord = {
  ref: 'default/default/abc',
  name: 'shop',
  status: 'Completed',
  createdAt: 1791939600000,
  durationMs: 12000
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.containers.buildHistory).mockResolvedValue([build])
  vi.mocked(api.containers.openTerminal).mockResolvedValue({
    tabId: 'prune-tab',
    hostId: 'h1',
    label: 'prune · build cache'
  })
})

describe('BuildsView', () => {
  it('shows build metadata and refreshes history', async () => {
    render(<BuildsView host={host} />)
    expect(await screen.findByText('shop')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText('12.0s')).toBeInTheDocument()
    vi.mocked(api.containers.buildHistory).mockResolvedValueOnce([
      { ...build, name: 'new-build', status: 'Error' }
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Refresh builds' }))
    expect(await screen.findByText('new-build')).toBeInTheDocument()
    expect(screen.queryByText('shop')).toBeNull()
  })

  it('confirms cache prune and announces the host terminal even when history is empty', async () => {
    const opened: string[] = []
    const off = onTerminalOpened((tab) => opened.push(tab.tabId))
    try {
      vi.mocked(api.containers.buildHistory).mockResolvedValue([])
      render(<BuildsView host={host} />)
      await screen.findByText('No builds on Box')
      fireEvent.click(screen.getByRole('button', { name: 'Prune build cache' }))
      expect(api.containers.openTerminal).not.toHaveBeenCalled()
      fireEvent.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Prune' })
      )
      await waitFor(() => expect(opened).toEqual(['prune-tab']))
      expect(api.containers.openTerminal).toHaveBeenCalledWith('h1', { kind: 'build-cache-prune' })
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(screen.queryByRole('status')).toBeNull()
    } finally {
      off()
    }
  })

  it('requires the protected host name and cancelling never prunes', async () => {
    render(<BuildsView host={{ ...host, protected: true }} />)
    await screen.findByText('shop')
    fireEvent.click(screen.getByRole('button', { name: 'Prune build cache' }))
    const dialog = screen.getByRole('alertdialog')
    const confirm = within(dialog).getByRole('button', { name: 'Prune' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Type the host name to confirm'), {
      target: { value: 'Box' }
    })
    expect(confirm).toBeEnabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.containers.openTerminal).not.toHaveBeenCalled()
  })

  it('keeps terminal opening failures visible and allows retry', async () => {
    vi.mocked(api.containers.openTerminal).mockRejectedValueOnce(new Error('SSH unavailable'))
    render(<BuildsView host={host} />)
    await screen.findByText('shop')
    fireEvent.click(screen.getByRole('button', { name: 'Prune build cache' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Prune' }))
    expect(await screen.findByText('SSH unavailable')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Prune' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(api.containers.openTerminal).toHaveBeenCalledTimes(2)
  })

  it('shows unsupported history errors and retries', async () => {
    vi.mocked(api.containers.buildHistory).mockRejectedValueOnce(
      new Error('Build history requires a newer Buildx')
    )
    render(<BuildsView host={host} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Build history requires a newer Buildx'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh builds' }))
    expect(await screen.findByText('shop')).toBeInTheDocument()
  })

  it('drops late history and pending confirmation when the host changes', async () => {
    let resolveLate!: (rows: BuildRecord[]) => void
    const { rerender } = render(<BuildsView host={host} />)
    await screen.findByText('shop')
    fireEvent.click(screen.getByRole('button', { name: 'Prune build cache' }))
    vi.mocked(api.containers.buildHistory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLate = resolve
        })
    )
    rerender(<BuildsView host={{ ...host, id: 'h2', label: 'Other' }} />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    rerender(<BuildsView host={{ ...host, id: 'h3', label: 'Third' }} />)
    await screen.findByText('shop')
    await act(async () => resolveLate([{ ...build, name: 'stale-build' }]))
    expect(screen.queryByText('stale-build')).toBeNull()
  })
})
