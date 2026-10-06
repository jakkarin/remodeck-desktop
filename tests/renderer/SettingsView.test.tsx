import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { DEFAULT_PREFS, type Prefs, type Repo } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    repos: { updatePolicy: vi.fn().mockResolvedValue({}) },
    pushLog: { read: vi.fn() }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { SettingsView } from '../../src/renderer/src/components/SettingsView'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'
import { applyTheme } from '../../src/renderer/src/theme'
import type { SettingsSection } from '../../src/renderer/src/settingsOpener'

const refresh = vi.fn().mockResolvedValue(undefined)
const updatePrefsApi = vi.fn()

const repo = (over: Partial<Repo> = {}): Repo => ({
  id: 'r1',
  owner: 'acme',
  name: 'api',
  defaultBranch: 'main',
  protectedBranches: ['main'],
  alwaysAllowPush: true,
  enforceRules: false,
  ...over
})

const logEntries = [
  {
    time: '2026-10-03T10:00:00Z',
    repo: 'acme/api',
    workspaceId: 'w1',
    channel: 'review',
    updates: [{ ref: 'refs/heads/feat', oldSha: 'a', newSha: 'b' }],
    result: 'blocked',
    detail: 'protected branch'
  },
  {
    time: '2026-10-03T11:00:00Z',
    repo: 'acme/web',
    workspaceId: 'w2',
    channel: 'bridge',
    updates: [{ ref: 'refs/heads/main', oldSha: 'a', newSha: 'b' }],
    result: 'ok'
  }
]

/** Stateful stand-in for AppStateProvider's prefs handling (applies the theme like the real one). */
function Harness({
  repos,
  section,
  repoId
}: {
  repos: Repo[]
  section?: SettingsSection
  repoId?: string
}): React.JSX.Element {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const value: AppState = {
    hosts: [],
    statuses: {},
    repos,
    workspaces: [],
    activeHostId: null,
    selectHost: vi.fn(),
    gitCaps: {},
    probeGit: vi.fn(),
    activeWorkspaceId: null,
    selectWorkspace: vi.fn(),
    syncInfo: {},
    setStatus: vi.fn(),
    refresh,
    prefs,
    updatePrefs: async (patch) => {
      const next = (await updatePrefsApi(patch)) as Prefs
      setPrefs(next)
      applyTheme(next.theme)
    }
  }
  return (
    <AppStateContext.Provider value={value}>
      <SettingsView initialSection={section} initialRepoId={repoId} />
    </AppStateContext.Provider>
  )
}

function renderWith(
  section: SettingsSection | undefined = 'repositories',
  repos: Repo[] = [repo()],
  repoId?: string
): void {
  render(<Harness repos={repos} section={section} repoId={repoId} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.pushLog.read).mockResolvedValue(logEntries as never)
  updatePrefsApi.mockImplementation(async (patch: Partial<Prefs>) => ({
    ...DEFAULT_PREFS,
    ...patch
  }))
})
afterEach(() => applyTheme('system'))

describe('SettingsView navigation', () => {
  it('defaults to General and switches sections with aria-current', () => {
    render(<Harness repos={[repo()]} />)
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('button', { name: 'General' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByLabelText('Default protected branches')).toBeInTheDocument()
    fireEvent.click(within(nav).getByRole('button', { name: 'Appearance' }))
    expect(within(nav).getByRole('button', { name: 'Appearance' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(within(nav).getByRole('button', { name: 'General' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument()
  })

  it('honours initialSection and initialRepoId', () => {
    renderWith(
      'repositories',
      [repo(), repo({ id: 'r2', name: 'web', protectedBranches: ['dev'] })],
      'r2'
    )
    expect(screen.getByRole('button', { name: 'Repositories' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByLabelText('Protected branches for acme/web')).toHaveValue('dev')
    fireEvent.click(screen.getByRole('button', { name: 'acme/api' }))
    expect(screen.getByLabelText('Protected branches for acme/api')).toHaveValue('main')
  })

  it('falls back to the first repo and shows an empty state', () => {
    renderWith('repositories', [repo(), repo({ id: 'r2', name: 'web' })], 'missing')
    expect(screen.getByLabelText('Protected branches for acme/api')).toBeInTheDocument()
  })

  it('shows "No repos yet." when there are none', () => {
    renderWith('repositories', [])
    expect(screen.getByText('No repos yet.')).toBeInTheDocument()
  })
})

describe('Repositories section', () => {
  it('Revoke clears alwaysAllowPush and refreshes', async () => {
    renderWith()
    fireEvent.click(screen.getByText('Revoke'))
    await waitFor(() =>
      expect(api.repos.updatePolicy).toHaveBeenCalledWith('r1', { alwaysAllowPush: false })
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('toggles enforceRules', async () => {
    renderWith()
    fireEvent.click(screen.getByLabelText(/Enforce rules/))
    await waitFor(() =>
      expect(api.repos.updatePolicy).toHaveBeenCalledWith('r1', { enforceRules: true })
    )
  })

  it('commits protected branches on Enter, split and trimmed', async () => {
    renderWith()
    const input = screen.getByLabelText(/Protected branches/)
    fireEvent.change(input, { target: { value: ' main, release/* ,, ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(api.repos.updatePolicy).toHaveBeenCalledWith('r1', {
        protectedBranches: ['main', 'release/*']
      })
    )
  })
})

describe('General section', () => {
  it('commits default protected branches on Enter and on blur, only when changed', async () => {
    renderWith('general')
    const input = screen.getByLabelText('Default protected branches')
    expect(input).toHaveValue('main, master')
    expect(screen.getByText(/newly added repos only/)).toBeInTheDocument()
    fireEvent.blur(input)
    expect(updatePrefsApi).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: ' main, release/* ,, ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(updatePrefsApi).toHaveBeenCalledWith({
        defaultProtectedBranches: ['main', 'release/*']
      })
    )
    const again = screen.getByLabelText('Default protected branches')
    fireEvent.change(again, { target: { value: 'dev' } })
    fireEvent.blur(again)
    await waitFor(() =>
      expect(updatePrefsApi).toHaveBeenLastCalledWith({ defaultProtectedBranches: ['dev'] })
    )
  })

  it('shows the error when saving fails', async () => {
    updatePrefsApi.mockRejectedValue(new Error('bad branches'))
    renderWith('general')
    const input = screen.getByLabelText('Default protected branches')
    fireEvent.change(input, { target: { value: 'x' } })
    fireEvent.blur(input)
    expect(await screen.findByText('bad branches')).toBeInTheDocument()
  })
})

describe('Appearance section', () => {
  it('theme change calls update and sets / removes data-theme', async () => {
    renderWith('appearance')
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }))
    await waitFor(() => expect(updatePrefsApi).toHaveBeenCalledWith({ theme: 'dark' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    fireEvent.click(screen.getByRole('radio', { name: 'System' }))
    await waitFor(() => expect(document.documentElement.hasAttribute('data-theme')).toBe(false))
  })

  it('font size change calls update with a number', async () => {
    renderWith('appearance')
    const select = screen.getByLabelText('Terminal font size')
    expect(select).toHaveValue('13')
    fireEvent.change(select, { target: { value: '16' } })
    await waitFor(() => expect(updatePrefsApi).toHaveBeenCalledWith({ terminalFontSize: 16 }))
    await waitFor(() => expect(select).toHaveValue('16'))
  })
})

describe('Push log section', () => {
  it('renders the log with a badge, local time and ISO title', async () => {
    renderWith('pushLog')
    expect(await screen.findByText('protected branch')).toBeInTheDocument()
    expect(api.pushLog.read).toHaveBeenCalledWith(200)
    const badge = screen.getByText('blocked')
    expect(badge).toHaveClass('badge', 'badge-danger', 'nowrap')
    expect(screen.getByText('ok')).toHaveClass('badge-success')
    const time = screen.getByTitle('2026-10-03T10:00:00Z')
    expect(time).toHaveTextContent(new Date('2026-10-03T10:00:00Z').toLocaleString())
  })

  it('filters by repo and refreshes', async () => {
    renderWith('pushLog')
    await screen.findByText('protected branch')
    const filter = screen.getByLabelText('Filter by repo')
    expect(
      within(filter)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['All', 'acme/api', 'acme/web'])
    fireEvent.change(filter, { target: { value: 'acme/web' } })
    expect(screen.queryByText('protected branch')).toBeNull()
    expect(screen.getByText('refs/heads/main')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }))
    await waitFor(() => expect(api.pushLog.read).toHaveBeenCalledTimes(2))
  })
})
