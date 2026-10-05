import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Host, HostStatus, Workspace } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    on: vi.fn(() => () => undefined),
    hosts: { list: vi.fn(), status: vi.fn(), connect: vi.fn(), add: vi.fn() },
    repos: { list: vi.fn(), listGitHub: vi.fn().mockResolvedValue([]) },
    workspaces: {
      list: vi.fn(),
      setActive: vi.fn(),
      branches: vi.fn().mockResolvedValue([]),
      worktrees: vi.fn().mockResolvedValue([]),
      commits: vi.fn().mockResolvedValue([]),
      files: vi.fn().mockResolvedValue([]),
      diff: vi.fn().mockResolvedValue('')
    },
    terminal: { open: vi.fn() }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options = {}
    loadAddon = vi.fn()
    open = vi.fn()
    onData = vi.fn(() => ({ dispose: vi.fn() }))
    onResize = vi.fn(() => ({ dispose: vi.fn() }))
    write = vi.fn()
    dispose = vi.fn()
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  }
}))

import { api } from '../../src/renderer/src/api'
import App from '../../src/renderer/src/App'

const host: Host = { id: 'h1', sshHost: 'box', label: 'Box' }
const ws: Workspace = { id: 'w1', repoId: 'r1', hostId: 'h1', sandboxPath: '~/repos/api' }

function setup(hosts: Host[], workspaces: Workspace[], status: HostStatus): void {
  vi.mocked(api.hosts.list).mockResolvedValue(hosts)
  vi.mocked(api.hosts.status).mockResolvedValue(status)
  vi.mocked(api.repos.list).mockResolvedValue([])
  vi.mocked(api.workspaces.list).mockResolvedValue(workspaces)
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
  vi.clearAllMocks()
  localStorage.clear()
})

describe('App empty states', () => {
  it('no hosts: invites adding the first sandbox, top bar stays', async () => {
    setup([], [], { state: 'disconnected', warnings: [] })
    render(<App />)
    expect(await screen.findByText('เพิ่ม sandbox แรก')).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add host' }))
    expect(await screen.findByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('hosts but no workspace, connected: offers Clone repo', async () => {
    setup([host], [], { state: 'connected', warnings: [] })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Clone repo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })

  it('hosts but none connected: offers Connect for the first host', async () => {
    setup([host], [], { state: 'disconnected', warnings: [] })
    vi.mocked(api.hosts.connect).mockResolvedValue({ state: 'connected', warnings: [] })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(api.hosts.connect).toHaveBeenCalledWith('h1'))
  })
})

describe('App with a workspace', () => {
  it('shows the branches pane and the terminal bar with a collapse toggle', async () => {
    setup([host], [ws], { state: 'connected', warnings: [] })
    vi.mocked(api.workspaces.branches).mockResolvedValue([])
    render(<App />)
    expect(await screen.findByRole('listbox', { name: 'Branches' })).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Collapse terminal' })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Expand terminal' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('regit.layout') ?? '{}').collapsed).toBe(true)
  })

  it('the + button opens a terminal in the active workspace', async () => {
    setup([host], [ws], { state: 'connected', warnings: [] })
    vi.mocked(api.terminal.open).mockResolvedValue({ tabId: 't1', label: 'x' })
    render(<App />)
    const plus = await screen.findByRole('button', { name: 'New terminal' })
    await waitFor(() => expect(plus).toBeEnabled())
    fireEvent.click(plus)
    await waitFor(() => expect(api.terminal.open).toHaveBeenCalledWith('w1', undefined))
  })

  it('the + button is disabled with a tooltip when the host is disconnected', async () => {
    setup([host], [ws], { state: 'disconnected', warnings: [] })
    render(<App />)
    const plus = await screen.findByRole('button', { name: 'New terminal' })
    expect(plus).toBeDisabled()
    expect(plus).toHaveAttribute('title')
  })
})
