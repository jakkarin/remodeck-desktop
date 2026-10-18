import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DEFAULT_PREFS, type Host, type HostStatus } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: { hosts: { connect: vi.fn(), update: vi.fn() } },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))
vi.mock('../../src/renderer/src/components/HostSettingsDialog', () => ({
  HostSettingsDialog: ({ host }: { host: Host }) => (
    <div role="dialog" aria-label={`Host settings ${host.label}`} />
  )
}))

const platform = vi.hoisted(() => ({ windows: true }))
vi.mock('../../src/renderer/src/platform', () => ({
  get isWindows() {
    return platform.windows
  }
}))

import { api } from '../../src/renderer/src/api'
import { ConnectPanel } from '../../src/renderer/src/components/ConnectPanel'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

const host: Host = { id: 'h1', sshHost: 'prod', label: 'Alpha', protected: false }

function makeState(over: Partial<AppState> = {}): AppState {
  return {
    hosts: [host],
    statuses: { h1: { state: 'disconnected' } },
    repos: [],
    workspaces: [],
    activeHostId: 'h1',
    selectHost: vi.fn(),
    gitCaps: {},
    probeGit: vi.fn().mockResolvedValue(undefined),
    dockerCaps: {},
    probeDocker: vi.fn().mockResolvedValue(undefined),
    activeModule: 'git',
    selectModule: vi.fn(),
    activeWorkspaceId: null,
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
    <ConnectPanel host={host} />
  </AppStateContext.Provider>
)

beforeEach(() => vi.clearAllMocks())

describe('ConnectPanel', () => {
  it('shows the not-connected view and connects', async () => {
    const up: HostStatus = { state: 'connected' }
    vi.mocked(api.hosts.connect).mockResolvedValue(up)
    const v = makeState()
    render(ui(v))
    expect(screen.getByRole('heading', { name: 'Alpha is not connected' })).toBeInTheDocument()
    expect(screen.getByText('ssh prod')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(v.setStatus).toHaveBeenCalledWith('h1', up))
  })

  it('shows Retry and Host settings after a failed connect', async () => {
    vi.mocked(api.hosts.connect).mockRejectedValue(
      new Error('prod: Permission denied (publickey).')
    )
    render(ui(makeState()))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('prod: Permission denied (publickey).')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Couldn’t reach Alpha' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Host settings' }))
    expect(screen.getByRole('dialog', { name: /Host settings/ })).toBeInTheDocument()
  })

  it('shows the failed view when connect resolves to an error status', async () => {
    const bad: HostStatus = { state: 'error', error: 'Connection refused' }
    vi.mocked(api.hosts.connect).mockResolvedValue(bad)
    const v = makeState()
    render(ui(v))
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('Connection refused')).toBeInTheDocument()
    expect(v.setStatus).toHaveBeenCalledWith('h1', bad)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('shows the failed view when the host is already in error state', () => {
    render(ui(makeState({ statuses: { h1: { state: 'error', error: 'Timed out' } } })))
    expect(screen.getByRole('heading', { name: 'Couldn’t reach Alpha' })).toBeInTheDocument()
    expect(screen.getByText('Timed out')).toBeInTheDocument()
  })

  it('retries and does not double-submit while connecting', async () => {
    let resolve: (s: HostStatus) => void = () => undefined
    vi.mocked(api.hosts.connect).mockReturnValueOnce(new Promise<HostStatus>((r) => (resolve = r)))
    render(ui(makeState({ statuses: { h1: { state: 'error', error: 'Timed out' } } })))
    const retry = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retry)
    expect(retry).toBeDisabled()
    fireEvent.click(retry)
    expect(api.hosts.connect).toHaveBeenCalledTimes(1)
    resolve({ state: 'connected' })
    await waitFor(() => expect(retry).toBeEnabled())
  })

  it('disables Connect while the host is connecting', () => {
    render(ui(makeState({ statuses: { h1: { state: 'connecting' } } })))
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled()
  })
})

describe('ConnectPanel for This computer', () => {
  it('says it runs on this computer instead of ssh', () => {
    const local: Host = {
      id: 'local',
      kind: 'local',
      sshHost: '',
      label: 'This computer',
      protected: false
    }
    render(
      <AppStateContext.Provider
        value={makeState({ hosts: [local], statuses: { local: { state: 'disconnected' } } })}
      >
        <ConnectPanel host={local} />
      </AppStateContext.Provider>
    )
    expect(screen.getByText('Runs on this computer with Git Bash')).toBeInTheDocument()
    expect(screen.queryByText(/^ssh /)).toBeNull()
  })

  it('says bash instead of Git Bash off Windows', () => {
    platform.windows = false
    try {
      const local: Host = {
        id: 'local',
        kind: 'local',
        sshHost: '',
        label: 'This computer',
        protected: false
      }
      render(
        <AppStateContext.Provider
          value={makeState({ hosts: [local], statuses: { local: { state: 'disconnected' } } })}
        >
          <ConnectPanel host={local} />
        </AppStateContext.Provider>
      )
      expect(screen.getByText('Runs on this computer with bash')).toBeInTheDocument()
    } finally {
      platform.windows = true
    }
  })
})
