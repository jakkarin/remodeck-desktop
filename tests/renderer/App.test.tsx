import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { DEFAULT_PREFS, type Host, type HostStatus, type Workspace } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    on: vi.fn(() => () => undefined),
    hosts: {
      list: vi.fn(),
      status: vi.fn(),
      connect: vi.fn(),
      add: vi.fn(),
      probeGit: vi.fn(),
      probeDocker: vi.fn()
    },
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
    terminal: { open: vi.fn(), close: vi.fn() },
    prefs: { get: vi.fn(), update: vi.fn() },
    gitAccess: { status: vi.fn(), install: vi.fn(), remove: vi.fn() },
    gitTokens: { list: vi.fn().mockResolvedValue([]) }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

const terminals = vi.hoisted(() => [] as { options: Record<string, unknown> }[])
const disposed = vi.hoisted(() => [] as { mock: { calls: unknown[] } }[])

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown>
    constructor(opts: Record<string, unknown>) {
      this.options = { ...opts }
      terminals.push(this)
      disposed.push(this.dispose)
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
import { announceTerminal } from '../../src/renderer/src/terminalEvents'

const host: Host = { id: 'h1', sshHost: 'box', label: 'Box', protected: false }
const ws: Workspace = { id: 'w1', repoId: 'r1', hostId: 'h1', sandboxPath: '~/repos/api' }

function setup(hosts: Host[], workspaces: Workspace[], status: HostStatus): void {
  vi.mocked(api.hosts.list).mockResolvedValue(hosts)
  vi.mocked(api.hosts.status).mockResolvedValue(status)
  vi.mocked(api.repos.list).mockResolvedValue([])
  vi.mocked(api.workspaces.list).mockResolvedValue(workspaces)
  vi.mocked(api.prefs.get).mockResolvedValue(DEFAULT_PREFS)
  vi.mocked(api.hosts.probeGit).mockResolvedValue({ version: '2', remoteHttp: true, forward: true })
  vi.mocked(api.hosts.probeDocker).mockResolvedValue({
    state: 'no-permission',
    detail: 'permission denied on docker.sock'
  })
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
  disposed.length = 0
  document.documentElement.removeAttribute('data-theme')
  localStorage.clear()
})

describe('App empty states', () => {
  it('no hosts: invites adding the first sandbox, top bar stays', async () => {
    setup([], [], { state: 'disconnected' })
    render(<App />)
    expect(await screen.findByText('Add your first sandbox')).toBeInTheDocument()
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

describe('App protected stripe', () => {
  it('marks .app protected only while the active host is protected', async () => {
    setup([{ ...host, protected: true }], [ws], { state: 'connected' })
    const { container, unmount } = render(<App />)
    await screen.findByRole('listbox', { name: 'Branches' })
    expect(container.querySelector('.app')).toHaveClass('protected')
    unmount()
    setup([host], [ws], { state: 'connected' })
    const second = render(<App />)
    await screen.findByRole('listbox', { name: 'Branches' })
    expect(second.container.querySelector('.app')).not.toHaveClass('protected')
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

  it('a disconnected host offers Connect instead of the terminal bar', async () => {
    setup([host], [ws], { state: 'disconnected' })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New terminal' })).toBeNull()
  })
})

describe('App layout', () => {
  it('opens settings from the activity bar', async () => {
    setup([host], [ws], { state: 'connected' })
    render(<App />)
    const git = await screen.findByRole('button', { name: 'Git' })
    expect(git).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('region', { name: 'Settings' })).toBeInTheDocument()
  })

  it('rail Settings is pressed while the settings page shows, and Git returns', async () => {
    setup([host], [ws], { state: 'connected' })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'Switch host' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Git' }))
    expect(screen.queryByRole('region', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('switching host hides but keeps the other host terminals', async () => {
    const host2: Host = { id: 'h2', sshHost: 'box2', label: 'Box2', protected: false }
    const ws2: Workspace = { id: 'w2', repoId: 'r1', hostId: 'h2', sandboxPath: '~/repos/api' }
    setup([host, host2], [ws, ws2], { state: 'connected' })
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'New terminal' })).toBeEnabled())
    act(() => {
      announceTerminal({ tabId: 't1', label: 'one', hostId: 'h1' })
      announceTerminal({ tabId: 't2', label: 'two', hostId: 'h2' })
    })
    expect(screen.getByRole('button', { name: 'one' })).toBeVisible()
    expect(screen.queryByText('two')).toBeNull()
    expect(terminals).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Switch host' }))
    fireEvent.click(await screen.findByText('Box2'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'two' })).toBeVisible())
    expect(screen.queryByText('one')).toBeNull()
    expect(terminals).toHaveLength(2)
    expect(api.terminal.close).not.toHaveBeenCalled()
  })
})

describe('App terminals survive host gating', () => {
  it('keeps xterm instances alive while the host is disconnected and back', async () => {
    setup([host], [ws], { state: 'connected' })
    const handlers: Record<string, (...a: unknown[]) => void> = {}
    vi.mocked(api.on).mockImplementation(((ch: string, cb: (...a: unknown[]) => void) => {
      handlers[ch] = cb
      return () => undefined
    }) as never)
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'New terminal' })).toBeEnabled())
    act(() => {
      announceTerminal({ tabId: 't1', label: 'one', hostId: 'h1' })
      announceTerminal({ tabId: 't2', label: 'two', hostId: 'h1' })
    })
    expect(terminals).toHaveLength(2)
    act(() => handlers['host-status']('h1', { state: 'disconnected' }))
    expect(await screen.findByRole('button', { name: 'Connect' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New terminal' })).toBeNull()
    act(() => handlers['host-status']('h1', { state: 'connected' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'New terminal' })).toBeEnabled())
    expect(terminals).toHaveLength(2)
    expect(disposed.every((d) => d.mock.calls.length === 0)).toBe(true)
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

  it('the activity bar opens settings; changing the theme updates prefs and data-theme', async () => {
    setup([host], [ws], { state: 'connected' })
    vi.mocked(api.prefs.update).mockResolvedValue({ ...DEFAULT_PREFS, theme: 'light' })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const dialog = screen.getByRole('region', { name: 'Settings' })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Light' }))
    await waitFor(() => expect(api.prefs.update).toHaveBeenCalledWith({ theme: 'light' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
  })

  it('Manage tokens in Host settings closes the dialog and opens Git tokens', async () => {
    setup([host], [ws], { state: 'connected' })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Switch host' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings for Box' }))
    const dialog = await screen.findByRole('dialog', { name: 'Host settings' })
    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: 'Enable git access on this host' })
    )
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Manage tokens' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Git tokens' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('Repo settings in the workspace menu opens settings at that repo', async () => {
    setup([host], [ws], { state: 'connected' })
    vi.mocked(api.repos.list).mockResolvedValue([{ ...repo, id: 'r0', name: 'other' }, repo])
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Switch workspace' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Workspace menu acme/api' }), {
      key: 'Enter'
    })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Repo settings…' }))
    const dialog = await screen.findByRole('region', { name: 'Settings' })
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
    const dialog = screen.getByRole('region', { name: 'Settings' })
    fireEvent.change(within(dialog).getByLabelText('Terminal font size'), {
      target: { value: '18' }
    })
    await waitFor(() => expect(terminals[0].options.fontSize).toBe(18))
    expect(terminals).toHaveLength(1)
  })
})

describe('App module switch', () => {
  it('Containers shows the docker gate, persists, and restores on reload', async () => {
    setup([host], [ws], { state: 'connected' })
    const first = render(<App />)
    const git = await screen.findByRole('button', { name: 'Git' })
    fireEvent.click(screen.getByRole('button', { name: 'Containers' }))
    expect(await screen.findByText('permission denied on docker.sock')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Containers' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(git).toHaveAttribute('aria-pressed', 'false')
    expect(localStorage.getItem('remodeck.activeModule')).toBe('"containers"')
    first.unmount()
    render(<App />)
    expect(await screen.findByText('permission denied on docker.sock')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Switch workspace' })).toBeNull()
  })

  it('keeps terminals alive across a module switch', async () => {
    setup([host], [ws], { state: 'connected' })
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'New terminal' })).toBeEnabled())
    act(() => {
      announceTerminal({ tabId: 't1', label: 'one', hostId: 'h1' })
    })
    expect(terminals).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Containers' }))
    await screen.findByText('permission denied on docker.sock')
    fireEvent.click(screen.getByRole('button', { name: 'Git' }))
    await screen.findByRole('listbox', { name: 'Branches' })
    expect(terminals).toHaveLength(1)
    expect(disposed.every((d) => d.mock.calls.length === 0)).toBe(true)
    expect(api.terminal.close).not.toHaveBeenCalled()
  })
})
