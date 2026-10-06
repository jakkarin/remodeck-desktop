import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DEFAULT_PREFS, type Host, type HostStatus, type Workspace } from '../../src/shared/types'

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
    terminal: { open: vi.fn() },
    prefs: { get: vi.fn(), update: vi.fn() }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

const terminals = vi.hoisted(() => [] as { options: Record<string, unknown> }[])

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown>
    constructor(opts: Record<string, unknown>) {
      this.options = { ...opts }
      terminals.push(this)
    }
    loadAddon = vi.fn()
    open = vi.fn()
    onData = vi.fn(() => ({ dispose: vi.fn() }))
    onResize = vi.fn(() => ({ dispose: vi.fn() }))
    write = vi.fn()
    attachCustomKeyEventHandler = vi.fn()
    hasSelection = vi.fn(() => false)
    getSelection = vi.fn(() => '')
    clearSelection = vi.fn()
    paste = vi.fn()
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

const host: Host = { id: 'h1', sshHost: 'box', label: 'Box', protected: false }
const ws: Workspace = { id: 'w1', repoId: 'r1', hostId: 'h1', sandboxPath: '~/repos/api' }

function setup(hosts: Host[], workspaces: Workspace[], status: HostStatus): void {
  vi.mocked(api.hosts.list).mockResolvedValue(hosts)
  vi.mocked(api.hosts.status).mockResolvedValue(status)
  vi.mocked(api.repos.list).mockResolvedValue([])
  vi.mocked(api.workspaces.list).mockResolvedValue(workspaces)
  vi.mocked(api.prefs.get).mockResolvedValue(DEFAULT_PREFS)
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
  terminals.length = 0
  document.documentElement.removeAttribute('data-theme')
  localStorage.clear()
})

describe('App empty states', () => {
  it('no hosts: invites adding the first sandbox, top bar stays', async () => {
    setup([], [], { state: 'disconnected' })
    render(<App />)
    expect(await screen.findByText('เพิ่ม sandbox แรก')).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add host' }))
    expect(await screen.findByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('hosts but no workspace, connected: offers Clone repo', async () => {
    setup([host], [], { state: 'connected' })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Clone repo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull()
  })

  it('hosts but none connected: offers Connect for the first host', async () => {
    setup([host], [], { state: 'disconnected' })
    vi.mocked(api.hosts.connect).mockResolvedValue({ state: 'connected' })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(api.hosts.connect).toHaveBeenCalledWith('h1'))
  })
})

describe('App with a workspace', () => {
  it('shows the branches pane and the terminal bar with a collapse toggle', async () => {
    setup([host], [ws], { state: 'connected' })
    vi.mocked(api.workspaces.branches).mockResolvedValue([])
    render(<App />)
    expect(await screen.findByRole('listbox', { name: 'Branches' })).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Collapse terminal' })
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Expand terminal' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('remodeck.layout') ?? '{}').collapsed).toBe(true)
  })

  it('the + button opens a terminal in the active workspace', async () => {
    setup([host], [ws], { state: 'connected' })
    vi.mocked(api.terminal.open).mockResolvedValue({ tabId: 't1', label: 'x' })
    render(<App />)
    const plus = await screen.findByRole('button', { name: 'New terminal' })
    await waitFor(() => expect(plus).toBeEnabled())
    fireEvent.click(plus)
    await waitFor(() => expect(api.terminal.open).toHaveBeenCalledWith('w1', undefined))
  })

  it('the + button is disabled with a tooltip when the host is disconnected', async () => {
    setup([host], [ws], { state: 'disconnected' })
    render(<App />)
    const plus = await screen.findByRole('button', { name: 'New terminal' })
    expect(plus).toBeDisabled()
    expect(plus).toHaveAttribute('title')
  })
})

describe('App prefs', () => {
  const repo = {
    id: 'r1',
    owner: 'acme',
    name: 'api',
    defaultBranch: 'main',
    protectedBranches: ['main'],
    alwaysAllowPush: false,
    enforceRules: true
  }

  it('applies the stored theme at startup', async () => {
    setup([host], [ws], { state: 'connected' })
    vi.mocked(api.prefs.get).mockResolvedValue({ ...DEFAULT_PREFS, theme: 'dark' })
    render(<App />)
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
  })

  it('the top bar opens settings; changing the theme updates prefs and data-theme', async () => {
    setup([host], [ws], { state: 'connected' })
    vi.mocked(api.prefs.update).mockResolvedValue({ ...DEFAULT_PREFS, theme: 'light' })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Appearance' }))
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Light' }))
    await waitFor(() => expect(api.prefs.update).toHaveBeenCalledWith({ theme: 'light' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
  })

  it('Repo settings in the workspace menu opens settings at that repo', async () => {
    setup([host], [ws], { state: 'connected' })
    vi.mocked(api.repos.list).mockResolvedValue([{ ...repo, id: 'r0', name: 'other' }, repo])
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Switch workspace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Workspace menu acme/api' }))
    fireEvent.click(screen.getByRole('button', { name: 'Repo settings…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    expect(within(dialog).getByRole('button', { name: 'Repositories' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(within(dialog).getByLabelText('Protected branches for acme/api')).toBeInTheDocument()
  })

  it('font size change updates open terminals without recreating them', async () => {
    setup([host], [ws], { state: 'connected' })
    vi.mocked(api.prefs.get).mockResolvedValue({ ...DEFAULT_PREFS, terminalFontSize: 15 })
    vi.mocked(api.prefs.update).mockResolvedValue({ ...DEFAULT_PREFS, terminalFontSize: 18 })
    vi.mocked(api.terminal.open).mockResolvedValue({ tabId: 't1', label: 'x' })
    render(<App />)
    await waitFor(() => expect(document.documentElement).toBeTruthy())
    const plus = await screen.findByRole('button', { name: 'New terminal' })
    await waitFor(() => expect(plus).toBeEnabled())
    // wait for prefs to load before opening so the terminal is created with the stored size
    await new Promise((r) => setTimeout(r, 0))
    fireEvent.click(plus)
    await waitFor(() => expect(terminals).toHaveLength(1))
    expect(terminals[0].options.fontSize).toBe(15)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Appearance' }))
    fireEvent.change(within(dialog).getByLabelText('Terminal font size'), {
      target: { value: '18' }
    })
    await waitFor(() => expect(terminals[0].options.fontSize).toBe(18))
    expect(terminals).toHaveLength(1)
  })
})
