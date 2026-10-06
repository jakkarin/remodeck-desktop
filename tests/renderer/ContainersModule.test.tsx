import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DEFAULT_PREFS, type HostStatus } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    hosts: { connect: vi.fn() },
    containers: { open: vi.fn().mockResolvedValue([]), action: vi.fn() },
    on: vi.fn(() => () => {})
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { ContainersModule } from '../../src/renderer/src/components/ContainersModule'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

const up: HostStatus = { state: 'connected' }
const down: HostStatus = { state: 'disconnected' }

function makeState(over: Partial<AppState> = {}): AppState {
  return {
    hosts: [{ id: 'h1', sshHost: 'a', label: 'Box', protected: false }],
    statuses: { h1: up },
    repos: [],
    workspaces: [],
    activeHostId: 'h1',
    selectHost: vi.fn(),
    gitCaps: {},
    probeGit: vi.fn().mockResolvedValue(undefined),
    dockerCaps: {},
    probeDocker: vi.fn().mockResolvedValue(undefined),
    activeModule: 'containers',
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
    <ContainersModule bottom={<div>term-slot</div>} bottomCollapsed={false} />
  </AppStateContext.Provider>
)

beforeEach(() => vi.clearAllMocks())

describe('ContainersModule', () => {
  it('shows the empty state without a host', () => {
    render(ui(makeState({ hosts: [], activeHostId: null })))
    expect(screen.getByText('เพิ่ม sandbox แรก')).toBeInTheDocument()
  })

  it('offers Connect when the host is down', () => {
    const v = makeState({ statuses: { h1: down } })
    render(ui(v))
    expect(screen.getByText('Box ยังไม่ได้ connect')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(api.hosts.connect).toHaveBeenCalledWith('h1')
  })

  it('probes docker once when entering a connected host', () => {
    const v = makeState()
    const { rerender } = render(ui(v))
    rerender(ui({ ...v }))
    rerender(ui({ ...v }))
    expect(v.probeDocker).toHaveBeenCalledTimes(1)
    expect(v.probeDocker).toHaveBeenCalledWith('h1')
    expect(screen.getByText('กำลังตรวจ docker…')).toBeInTheDocument()
  })

  it('shows the probe error with a force retry', async () => {
    const v = makeState({ probeDocker: vi.fn().mockRejectedValue(new Error('ssh dropped')) })
    render(ui(v))
    expect(await screen.findByText('ssh dropped')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจอีกครั้ง' }))
    expect(v.probeDocker).toHaveBeenLastCalledWith('h1', true)
  })

  it('shows the no-permission detail and re-probes with force', () => {
    const v = makeState({
      dockerCaps: { h1: { state: 'no-permission', detail: 'line1\nline2' } }
    })
    const { container } = render(ui(v))
    expect(screen.getByText(/line1/)).toHaveStyle({ whiteSpace: 'pre-wrap' })
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'ตรวจอีกครั้ง' }))
    expect(v.probeDocker).toHaveBeenCalledWith('h1', true)
  })

  it('renders the containers view and the bottom slot when ok', async () => {
    const v = makeState({
      dockerCaps: { h1: { state: 'ok', version: '27', apiVersion: '1.47' } }
    })
    render(ui(v))
    expect(await screen.findByText('ยังไม่มี container บน Box')).toBeInTheDocument()
    expect(screen.getByText('term-slot')).toBeInTheDocument()
    expect(v.probeDocker).not.toHaveBeenCalled()
  })
})
