import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { DEFAULT_PREFS, type HostStatus } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    hosts: {
      connect: vi.fn(),
      disconnect: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
      update: vi.fn(),
      status: vi.fn()
    },
    repos: { listGitHub: vi.fn().mockResolvedValue([]) },
    workspaces: {
      clone: vi.fn(),
      inspectExisting: vi.fn(),
      addExisting: vi.fn(),
      remove: vi.fn(),
      rebuildMirror: vi.fn()
    }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { WorkspaceSwitcher } from '../../src/renderer/src/components/WorkspaceSwitcher'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'
import { SettingsOpenerContext } from '../../src/renderer/src/settingsOpener'

const openSettings = vi.fn()

const down: HostStatus = { state: 'disconnected' }
const up: HostStatus = { state: 'connected' }

const repo = (id: string, owner: string, name: string): AppState['repos'][number] => ({
  id,
  owner,
  name,
  defaultBranch: 'main',
  protectedBranches: [],
  alwaysAllowPush: false,
  enforceRules: false
})
const relist: Partial<AppState> = {
  repos: [repo('r2', 'relist', 'relist-api'), repo('r3', 'relist', 'relist-panel')],
  workspaces: [
    { id: 'w2', repoId: 'r2', hostId: 'h1', sandboxPath: '~/repos/relist-api' },
    { id: 'w3', repoId: 'r3', hostId: 'h1', sandboxPath: '~/repos/relist-panel' }
  ],
  activeWorkspaceId: 'w2'
}
/** Radix opens dropdown menus on pointerdown or Enter; jsdom lacks PointerEvent, so use the keyboard. */
const openRowMenu = (label: string): void => {
  fireEvent.keyDown(screen.getByRole('button', { name: `Workspace menu ${label}` }), {
    key: 'Enter'
  })
}

function renderWith(statuses: Record<string, HostStatus>, over: Partial<AppState> = {}): AppState {
  const value: AppState = {
    hosts: [
      { id: 'h1', sshHost: 'a', label: 'Alpha', protected: false },
      { id: 'h2', sshHost: 'b', label: 'Beta', protected: false }
    ],
    statuses,
    repos: [repo('r1', 'acme', 'api')],
    workspaces: [{ id: 'w1', repoId: 'r1', hostId: 'h1', sandboxPath: '~/repos/api' }],
    activeHostId: 'h1',
    selectHost: vi.fn(),
    gitCaps: {},
    probeGit: vi.fn(),
    dockerCaps: {},
    probeDocker: vi.fn(),
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
  render(
    <AppStateContext.Provider value={value}>
      <SettingsOpenerContext.Provider value={openSettings}>
        <WorkspaceSwitcher />
      </SettingsOpenerContext.Provider>
    </AppStateContext.Provider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }))
  return value
}

beforeEach(() => vi.clearAllMocks())

describe('WorkspaceSwitcher', () => {
  it('lists only workspaces of the active host', () => {
    renderWith(
      { h1: up, h2: up },
      {
        workspaces: [
          { id: 'w1', repoId: 'r1', hostId: 'h1', sandboxPath: '~/repos/api' },
          { id: 'w2', repoId: 'r1', hostId: 'h2', sandboxPath: '~/other/api' }
        ]
      }
    )
    expect(screen.getByText('~/repos/api')).toBeInTheDocument()
    expect(screen.queryByText('~/other/api')).toBeNull()
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(screen.queryByRole('button', { name: /Add host/ })).toBeNull()
  })

  it('dims workspaces of a disconnected host but still selects them', () => {
    const v = renderWith({ h1: down, h2: up })
    const row = screen.getByRole('button', { name: /^acme\/api/ })
    expect(row.parentElement).toHaveClass('opacity-55')
    fireEvent.click(row)
    expect(v.selectWorkspace).toHaveBeenCalledWith('w1')
  })

  it('workspace menu rebuilds the mirror', async () => {
    vi.mocked(api.workspaces.rebuildMirror).mockResolvedValue(undefined)
    renderWith({ h1: up, h2: up })
    openRowMenu('acme/api')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rebuild mirror' }))
    await waitFor(() => expect(api.workspaces.rebuildMirror).toHaveBeenCalledWith('r1', 'w1'))
  })

  it('workspace menu Repo settings opens settings at that repo', () => {
    renderWith({ h1: up, h2: up })
    openRowMenu('acme/api')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Repo settings…' }))
    expect(openSettings).toHaveBeenCalledWith('repositories', 'r1')
  })

  it('workspace menu removes the workspace', async () => {
    vi.mocked(api.workspaces.remove).mockResolvedValue(undefined)
    const v = renderWith({ h1: up, h2: up })
    openRowMenu('acme/api')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove workspace' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Remove workspace' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(v.refresh).toHaveBeenCalled())
    expect(api.workspaces.remove).toHaveBeenCalledWith('w1', false)
  })

  it('Clone and Add existing are disabled when the active host is disconnected, even if another is connected', () => {
    renderWith({ h1: down, h2: up })
    expect(screen.getByRole('button', { name: /Clone repo/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Add existing repo/ })).toBeDisabled()
  })

  it('Clone repo targets the active host only', () => {
    renderWith({ h1: up, h2: up })
    fireEvent.click(screen.getByRole('button', { name: /Clone repo/ }))
    const dialog = screen.getByRole('dialog', { name: 'Clone' })
    expect(within(dialog).queryByLabelText('Host')).toBeNull()
  })

  it('Add existing repo selects the new workspace on success', async () => {
    vi.mocked(api.workspaces.addExisting).mockResolvedValue({
      id: 'w9',
      repoId: 'r1',
      hostId: 'h1',
      sandboxPath: '~/work/app'
    })
    vi.mocked(api.workspaces.inspectExisting).mockResolvedValue({
      owner: 'o',
      name: 'r',
      known: true,
      alwaysAllowPush: false
    })
    const v = renderWith({ h1: up, h2: up })
    fireEvent.click(screen.getByRole('button', { name: /Add existing repo/ }))
    const dialog = screen.getByRole('dialog', { name: 'Add existing repo' })
    expect(within(dialog).queryByLabelText('Host')).toBeNull()
    fireEvent.change(within(dialog).getByLabelText('Path'), { target: { value: '~/work/app' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Confirm & Add' }))
    await waitFor(() =>
      expect(api.workspaces.addExisting).toHaveBeenCalledWith('h1', '~/work/app', {
        owner: 'o',
        name: 'r'
      })
    )
    await waitFor(() => expect(v.selectWorkspace).toHaveBeenCalledWith('w9'))
    expect(v.refresh).toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Add existing repo' })).toBeNull()
  })

  it('closes on Escape, on an outside pointerdown, and after choosing a workspace', async () => {
    renderWith({ h1: up, h2: up })
    const panelOpen = (): boolean =>
      screen.queryByRole('textbox', { name: 'Find workspace' }) !== null
    expect(panelOpen()).toBe(true)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(panelOpen()).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }))
    expect(panelOpen()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /^acme\/api/ }))
    await waitFor(() => expect(panelOpen()).toBe(false))
  })

  it('filters workspaces by label, case-insensitive', () => {
    renderWith({ h1: up }, relist)
    fireEvent.change(screen.getByRole('textbox', { name: 'Find workspace' }), {
      target: { value: 'API' }
    })
    expect(screen.getByRole('button', { name: /^relist\/relist-api/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^relist\/relist-panel/ })).not.toBeInTheDocument()
  })

  it('filters by sandbox path', () => {
    renderWith({ h1: up }, relist)
    fireEvent.change(screen.getByRole('textbox', { name: 'Find workspace' }), {
      target: { value: 'repos/relist-pan' }
    })
    expect(screen.getByRole('button', { name: /^relist\/relist-panel/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^relist\/relist-api/ })).not.toBeInTheDocument()
  })

  it('shows "No matching workspaces" when nothing matches', () => {
    renderWith({ h1: up }, relist)
    fireEvent.change(screen.getByRole('textbox', { name: 'Find workspace' }), {
      target: { value: 'zzz' }
    })
    expect(screen.getByText('No matching workspaces')).toBeInTheDocument()
  })

  it('Enter on the search field opens the first match', async () => {
    const v = renderWith({ h1: up }, relist)
    const input = screen.getByRole('textbox', { name: 'Find workspace' })
    fireEvent.change(input, { target: { value: 'panel' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(v.selectWorkspace).toHaveBeenCalledWith('w3')
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Find workspace' })).toBeNull()
    )
  })

  it('search is cleared when the popover reopens', async () => {
    renderWith({ h1: up }, relist)
    fireEvent.change(screen.getByRole('textbox', { name: 'Find workspace' }), {
      target: { value: 'zzz' }
    })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Find workspace' }), { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Find workspace' })).toBeNull()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Switch workspace' }))
    expect(screen.getByRole('textbox', { name: 'Find workspace' })).toHaveValue('')
  })

  it('rows are keyboard-reachable buttons', () => {
    renderWith({ h1: up }, relist)
    const row = screen.getByRole('button', { name: /^relist\/relist-api/ })
    expect(row.tagName).toBe('BUTTON')
    expect(row).toHaveAttribute('aria-current', 'true')
  })
})
