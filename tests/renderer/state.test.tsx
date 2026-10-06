import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import type { Host, Workspace } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    hosts: { list: vi.fn(), status: vi.fn(), probeGit: vi.fn(), probeDocker: vi.fn() },
    repos: { list: vi.fn() },
    workspaces: { list: vi.fn(), remove: vi.fn(), setActive: vi.fn() },
    on: vi.fn()
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { AppStateProvider, useAppState } from '../../src/renderer/src/state'
import { RemoveWorkspaceDialog } from '../../src/renderer/src/components/RemoveDialogs'

const w = (id: string, hostId = 'h1'): Workspace => ({
  id,
  repoId: `r${id}`,
  hostId,
  sandboxPath: `~/${id}`
})

const hs = (...ids: string[]): Host[] =>
  ids.map((id) => ({ id, sshHost: id, label: id, protected: false }))

function Probe(): React.JSX.Element {
  const {
    activeWorkspaceId,
    workspaces,
    selectWorkspace,
    activeHostId,
    selectHost,
    gitCaps,
    probeGit,
    dockerCaps,
    probeDocker,
    refresh
  } = useAppState()
  const first = workspaces[0]
  return (
    <div>
      <span data-testid="active">{String(activeWorkspaceId)}</span>
      <span data-testid="host">{String(activeHostId)}</span>
      <span data-testid="caps">{JSON.stringify(gitCaps)}</span>
      <span data-testid="dcaps">{JSON.stringify(dockerCaps)}</span>
      <button onClick={() => void probeDocker('h1').catch(() => undefined)}>probe docker h1</button>
      <button onClick={() => selectWorkspace('w2')}>pick w2</button>
      <button onClick={() => selectHost('h2')}>pick h2</button>
      <button onClick={() => void refresh()}>refresh</button>
      <button onClick={() => void probeGit('h1').catch(() => undefined)}>probe h1</button>
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
  localStorage.clear()
  vi.mocked(api.on).mockReturnValue(() => undefined)
  vi.mocked(api.hosts.list).mockResolvedValue(hs('h1'))
  vi.mocked(api.hosts.status).mockResolvedValue({ state: 'connected' })
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

  it('restores the stored host and its last workspace on load', async () => {
    localStorage.setItem('remodeck.activeHost', JSON.stringify('h2'))
    localStorage.setItem('remodeck.lastWorkspace', JSON.stringify({ h2: 'w3' }))
    vi.mocked(api.hosts.list).mockResolvedValue(hs('h1', 'h2'))
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w1'), w('w2', 'h2'), w('w3', 'h2')])
    mount()
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('w3'))
    expect(screen.getByTestId('host')).toHaveTextContent('h2')
  })

  it('falls back to the first host when the stored host no longer exists', async () => {
    localStorage.setItem('remodeck.activeHost', JSON.stringify('gone'))
    vi.mocked(api.hosts.list).mockResolvedValue(hs('h1', 'h2'))
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w1'), w('w2', 'h2')])
    mount()
    await waitFor(() => expect(screen.getByTestId('host')).toHaveTextContent('h1'))
    expect(screen.getByTestId('active')).toHaveTextContent('w1')
  })

  it("selectHost switches to that host's last workspace", async () => {
    localStorage.setItem('remodeck.lastWorkspace', JSON.stringify({ h2: 'w3' }))
    vi.mocked(api.hosts.list).mockResolvedValue(hs('h1', 'h2'))
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w1'), w('w2', 'h2'), w('w3', 'h2')])
    mount()
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('w1'))
    fireEvent.click(screen.getByRole('button', { name: 'pick h2' }))
    expect(screen.getByTestId('host')).toHaveTextContent('h2')
    expect(screen.getByTestId('active')).toHaveTextContent('w3')
    expect(JSON.parse(localStorage.getItem('remodeck.activeHost') ?? 'null')).toBe('h2')
    expect(api.workspaces.setActive).toHaveBeenLastCalledWith('w3')
  })

  it('falls back when the active host is removed on refresh', async () => {
    vi.mocked(api.hosts.list).mockResolvedValue(hs('h1', 'h2'))
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w1'), w('w2', 'h2')])
    mount()
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('w1'))
    fireEvent.click(screen.getByRole('button', { name: 'pick h2' }))
    expect(screen.getByTestId('host')).toHaveTextContent('h2')
    // h2 and its workspace disappear; refresh.
    vi.mocked(api.hosts.list).mockResolvedValue(hs('h1'))
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w1')])
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await waitFor(() => expect(screen.getByTestId('host')).toHaveTextContent('h1'))
    expect(screen.getByTestId('active')).toHaveTextContent('w1')
  })

  it('selects a workspace on the fallback host when none was selected', async () => {
    vi.mocked(api.hosts.list).mockResolvedValue(hs('h1', 'h2'))
    vi.mocked(api.workspaces.list).mockResolvedValue([])
    mount()
    await waitFor(() => expect(api.workspaces.list).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'pick h2' }))
    expect(screen.getByTestId('host')).toHaveTextContent('h2')
    expect(screen.getByTestId('active')).toHaveTextContent('null')
    vi.mocked(api.hosts.list).mockResolvedValue(hs('h1'))
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w1')])
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await waitFor(() => expect(screen.getByTestId('host')).toHaveTextContent('h1'))
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('w1'))
  })

  it('probeGit stores the result under the host id', async () => {
    vi.mocked(api.hosts.list).mockResolvedValue(hs('h1'))
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w1')])
    vi.mocked(api.hosts.probeGit).mockResolvedValueOnce({
      version: '2.40',
      remoteHttp: true,
      forward: false
    })
    mount()
    await waitFor(() => expect(screen.getByTestId('host')).toHaveTextContent('h1'))
    fireEvent.click(screen.getByRole('button', { name: 'probe h1' }))
    await waitFor(() => expect(screen.getByTestId('caps')).toHaveTextContent('2.40'))
  })

  it('does not store anything when probeGit fails', async () => {
    vi.mocked(api.hosts.list).mockResolvedValue(hs('h1'))
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w1')])
    vi.mocked(api.hosts.probeGit).mockRejectedValueOnce(new Error('not connected'))
    mount()
    await waitFor(() => expect(screen.getByTestId('host')).toHaveTextContent('h1'))
    fireEvent.click(screen.getByRole('button', { name: 'probe h1' }))
    await waitFor(() => expect(api.hosts.probeGit).toHaveBeenCalledWith('h1', undefined))
    expect(screen.getByTestId('caps')).toHaveTextContent('{}')
  })

  it('clears git caps of a host when its status leaves connected', async () => {
    vi.mocked(api.hosts.list).mockResolvedValue(hs('h1'))
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w1')])
    vi.mocked(api.hosts.probeGit).mockResolvedValue(null)
    let onStatus: ((id: string, s: { state: string }) => void) | undefined
    vi.mocked(api.on).mockImplementation(((ev: string, cb: never) => {
      if (ev === 'host-status') onStatus = cb
      return () => undefined
    }) as never)
    mount()
    await waitFor(() => expect(screen.getByTestId('host')).toHaveTextContent('h1'))
    fireEvent.click(screen.getByRole('button', { name: 'probe h1' }))
    await waitFor(() => expect(screen.getByTestId('caps')).toHaveTextContent('"h1":null'))
    act(() => onStatus?.('h1', { state: 'disconnected' }))
    expect(screen.getByTestId('caps')).toHaveTextContent('{}')
  })

  it('ignores a probe result that resolves after the host disconnected', async () => {
    vi.mocked(api.hosts.list).mockResolvedValue(hs('h1'))
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w1')])
    let resolve: (v: null) => void = () => undefined
    vi.mocked(api.hosts.probeGit).mockReturnValue(new Promise((r) => (resolve = r)))
    let onStatus: ((id: string, s: { state: string }) => void) | undefined
    vi.mocked(api.on).mockImplementation(((ev: string, cb: never) => {
      if (ev === 'host-status') onStatus = cb
      return () => undefined
    }) as never)
    mount()
    await waitFor(() => expect(screen.getByTestId('host')).toHaveTextContent('h1'))
    fireEvent.click(screen.getByRole('button', { name: 'probe h1' }))
    act(() => onStatus?.('h1', { state: 'disconnected' }))
    await act(async () => resolve(null))
    expect(screen.getByTestId('caps')).toHaveTextContent('{}')
  })

  it('drops git caps of a host that refresh finds not connected', async () => {
    vi.mocked(api.hosts.list).mockResolvedValue(hs('h1'))
    vi.mocked(api.workspaces.list).mockResolvedValue([w('w1')])
    vi.mocked(api.hosts.probeGit).mockResolvedValue(null)
    mount()
    await waitFor(() => expect(screen.getByTestId('host')).toHaveTextContent('h1'))
    fireEvent.click(screen.getByRole('button', { name: 'probe h1' }))
    await waitFor(() => expect(screen.getByTestId('caps')).toHaveTextContent('"h1":null'))
    vi.mocked(api.hosts.status).mockResolvedValue({ state: 'disconnected' })
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await waitFor(() => expect(screen.getByTestId('caps')).toHaveTextContent('{}'))
  })

  describe('probeDocker', () => {
    const OK = { state: 'ok', version: '26', apiVersion: '1.45' } as const
    let onStatus: ((id: string, s: { state: string }) => void) | undefined
    beforeEach(() => {
      vi.mocked(api.hosts.list).mockResolvedValue(hs('h1'))
      vi.mocked(api.workspaces.list).mockResolvedValue([w('w1')])
      vi.mocked(api.on).mockImplementation(((ev: string, cb: never) => {
        if (ev === 'host-status') onStatus = cb
        return () => undefined
      }) as never)
    })

    it('stores the result under dockerCaps', async () => {
      vi.mocked(api.hosts.probeDocker).mockResolvedValueOnce(OK)
      mount()
      await waitFor(() => expect(screen.getByTestId('host')).toHaveTextContent('h1'))
      fireEvent.click(screen.getByRole('button', { name: 'probe docker h1' }))
      await waitFor(() => expect(screen.getByTestId('dcaps')).toHaveTextContent('"version":"26"'))
      expect(api.hosts.probeDocker).toHaveBeenCalledWith('h1', undefined)
    })

    it('drops a result that resolves after disconnect', async () => {
      let resolve: (v: typeof OK) => void = () => undefined
      vi.mocked(api.hosts.probeDocker).mockReturnValue(new Promise((r) => (resolve = r)))
      mount()
      await waitFor(() => expect(screen.getByTestId('host')).toHaveTextContent('h1'))
      fireEvent.click(screen.getByRole('button', { name: 'probe docker h1' }))
      act(() => onStatus?.('h1', { state: 'disconnected' }))
      await act(async () => resolve(OK))
      expect(screen.getByTestId('dcaps')).toHaveTextContent('{}')
    })

    it('clears dockerCaps on disconnect', async () => {
      vi.mocked(api.hosts.probeDocker).mockResolvedValue(OK)
      mount()
      await waitFor(() => expect(screen.getByTestId('host')).toHaveTextContent('h1'))
      fireEvent.click(screen.getByRole('button', { name: 'probe docker h1' }))
      await waitFor(() => expect(screen.getByTestId('dcaps')).toHaveTextContent('"h1"'))
      act(() => onStatus?.('h1', { state: 'disconnected' }))
      expect(screen.getByTestId('dcaps')).toHaveTextContent('{}')
    })
  })
})
