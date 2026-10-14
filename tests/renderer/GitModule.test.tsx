import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DEFAULT_PREFS, type GitCapability, type HostStatus } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: { hosts: { connect: vi.fn() } },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))
vi.mock('../../src/renderer/src/components/WorkspaceScreen', () => ({
  WorkspaceScreen: ({ workspaceId }: { workspaceId: string }) => (
    <div>workspace-screen {workspaceId}</div>
  )
}))

import { api } from '../../src/renderer/src/api'
import { GitModule } from '../../src/renderer/src/components/GitModule'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

const up: HostStatus = { state: 'connected' }
const down: HostStatus = { state: 'disconnected' }
const caps: GitCapability = { version: '2.40', remoteHttp: true, forward: true }

function makeState(over: Partial<AppState> = {}): AppState {
  return {
    hosts: [{ id: 'h1', sshHost: 'a', label: 'Box', protected: false }],
    statuses: { h1: up },
    repos: [],
    workspaces: [{ id: 'w1', repoId: 'r1', hostId: 'h1', sandboxPath: '~/repos/api' }],
    activeHostId: 'h1',
    selectHost: vi.fn(),
    gitCaps: {},
    probeGit: vi.fn().mockResolvedValue(undefined),
    dockerCaps: {},
    probeDocker: vi.fn().mockResolvedValue(undefined),
    activeModule: 'git',
    selectModule: vi.fn(),
    activeWorkspaceId: 'w1',
    selectWorkspace: vi.fn(),
    syncInfo: {},
    setStatus: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    prefs: DEFAULT_PREFS,
    updatePrefs: vi.fn().mockResolvedValue(undefined),
    ...over
  }
}
const ui = (v: AppState): React.JSX.Element => (
  <AppStateContext.Provider value={v}>
    <GitModule bottom={null} bottomCollapsed={false} />
  </AppStateContext.Provider>
)

beforeEach(() => vi.clearAllMocks())

describe('GitModule', () => {
  it('probes git once when entering a connected host', () => {
    const v = makeState()
    const { rerender } = render(ui(v))
    rerender(ui({ ...v }))
    rerender(ui({ ...v }))
    expect(v.probeGit).toHaveBeenCalledTimes(1)
    expect(v.probeGit).toHaveBeenCalledWith('h1')
    expect(screen.getByText('Checking git…')).toBeInTheDocument()
  })

  it('shows the no-git message and re-probes with force', () => {
    const v = makeState({ gitCaps: { h1: null } })
    render(ui(v))
    expect(screen.getByText('Git was not found on this host')).toBeInTheDocument()
    expect(screen.getByText('Install it first, then check again.')).toBeInTheDocument()
    expect(screen.getByText('sudo apt install git')).toBeInTheDocument()
    expect(screen.getByText('sudo dnf install git')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(v.probeGit).toHaveBeenCalledWith('h1', true)
  })

  it('shows the probe error with a retry when probing rejects', async () => {
    const v = makeState({ probeGit: vi.fn().mockRejectedValue(new Error('ssh dropped')) })
    render(ui(v))
    expect(await screen.findByText('ssh dropped')).toBeInTheDocument()
    expect(v.probeGit).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(v.probeGit).toHaveBeenLastCalledWith('h1', true)
  })

  it('shows the error on the no-git screen when a forced re-probe fails', async () => {
    const v = makeState({
      gitCaps: { h1: null },
      probeGit: vi.fn().mockRejectedValue(new Error('ssh dropped'))
    })
    render(ui(v))
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('ssh dropped')).toBeInTheDocument()
    expect(screen.getByText('Git was not found on this host')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled()
  })

  it('disables the re-probe button while a probe is in flight', async () => {
    let resolve: () => void = () => undefined
    const pending = new Promise<void>((r) => (resolve = r))
    const v = makeState({ gitCaps: { h1: null }, probeGit: vi.fn().mockReturnValue(pending) })
    render(ui(v))
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(screen.getByRole('button', { name: 'Check again' })).toBeDisabled()
    resolve()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled())
  })

  it('shows forward and http warnings', () => {
    const v = makeState({ gitCaps: { h1: { version: '2', remoteHttp: false, forward: false } } })
    render(ui(v))
    expect(screen.getByText(/does not support HTTP/)).toBeInTheDocument()
    expect(screen.getByText(/AllowTcpForwarding disabled/)).toBeInTheDocument()
    expect(screen.getByText('workspace-screen w1')).toBeInTheDocument()
  })

  it('dismissing a warning hides it, and another host with the same caps still shows it', () => {
    const forwardOff: GitCapability = { version: '2.40', remoteHttp: true, forward: false }
    const v = makeState({ gitCaps: { h1: forwardOff, h2: forwardOff } })
    const { rerender } = render(ui(v))
    expect(screen.getByText(/AllowTcpForwarding disabled/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/AllowTcpForwarding disabled/)).toBeNull()
    rerender(
      ui({
        ...v,
        hosts: [...v.hosts, { id: 'h2', sshHost: 'b', label: 'Other', protected: false }],
        statuses: { ...v.statuses, h2: up },
        activeHostId: 'h2',
        activeWorkspaceId: null
      })
    )
    expect(screen.getByText(/AllowTcpForwarding disabled/)).toBeInTheDocument()
  })

  it('asks to connect when the host is disconnected', () => {
    vi.mocked(api.hosts.connect).mockResolvedValue(up)
    const v = makeState({ statuses: { h1: down } })
    render(ui(v))
    expect(screen.getByRole('heading', { name: 'Box is not connected' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(api.hosts.connect).toHaveBeenCalledWith('h1')
    expect(v.probeGit).not.toHaveBeenCalled()
  })

  it('renders the workspace screen when git is present', () => {
    render(ui(makeState({ gitCaps: { h1: caps } })))
    expect(screen.getByText('workspace-screen w1')).toBeInTheDocument()
    expect(screen.queryByText(/does not support HTTP/)).toBeNull()
  })

  it('shows the empty state when there is no host', () => {
    render(ui(makeState({ hosts: [], activeHostId: null, workspaces: [] })))
    expect(screen.getByRole('button', { name: 'Add host' })).toBeInTheDocument()
  })

  it('shows the empty state when the host has no workspace', () => {
    render(ui(makeState({ gitCaps: { h1: caps }, workspaces: [], activeWorkspaceId: null })))
    expect(screen.getByText('No workspaces yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clone repo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add existing repo' })).toBeInTheDocument()
  })
})
