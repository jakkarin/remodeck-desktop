import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { GitAccessStatus, GitToken } from '../../src/shared/gitAccess'
import type { Host } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    gitAccess: { status: vi.fn(), install: vi.fn(), remove: vi.fn() },
    gitTokens: { list: vi.fn() }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { HostGitAccessPanel } from '../../src/renderer/src/components/HostGitAccessPanel'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

const WARNING =
  'Tokens are stored in plain text on this host. Anything running as this user can read them. Terminals opened from remodeck keep using the Git Bridge and push approval.'

const tokenA: GitToken = {
  id: 't1',
  provider: 'github',
  host: 'github.com',
  path: 'acme',
  login: 'a',
  label: 'Acme',
  expiresAt: null,
  updatedAt: '2026-01-01T00:00:00Z'
}
const tokenB: GitToken = { ...tokenA, id: 't2', path: 'other', label: 'Other' }

const okStatus: GitAccessStatus = {
  helperInstalled: true,
  includeActive: true,
  scopesOnTarget: ['github.com/acme'],
  cli: { path: '/usr/bin/gh', version: '2.50.0' },
  wrapper: {
    state: 'ours',
    version: 1,
    outdated: false,
    loginShell: true,
    nonLoginShell: true
  },
  otherHelpers: [],
  helperOrder: 'first',
  pathBlock: 'absent',
  stale: [],
  missing: []
}
const PATH_BOX = 'Add ~/.local/bin to PATH in ~/.bashrc so non-login shells use the gh wrapper'
const HELPER_BOX = /Ask remodeck's credential helper before the others/

const plainHost: Host = { id: 'h1', sshHost: 'box', label: 'Box', protected: false }
const installedHost: Host = {
  ...plainHost,
  gitAccess: { installedAt: '2026-01-01T00:00:00Z', installed: { t1: 'x' }, wrapperVersion: 1 }
}

const refresh = vi.fn().mockResolvedValue(undefined)

function renderPanel(host: Host, hosts: Host[] = [host], onClose?: () => void): void {
  const value = { refresh, hosts } as unknown as AppState
  render(
    <AppStateContext.Provider value={value}>
      <HostGitAccessPanel host={host} onClose={onClose} />
    </AppStateContext.Provider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  refresh.mockResolvedValue(undefined)
  vi.mocked(api.gitTokens.list).mockResolvedValue([tokenA, tokenB])
  vi.mocked(api.gitAccess.status).mockResolvedValue(okStatus)
})

describe('HostGitAccessPanel', () => {
  it('is off by default and does not touch the host', () => {
    renderPanel(plainHost)
    expect(
      screen.getByRole('checkbox', { name: 'Enable git access on this host' })
    ).not.toBeChecked()
    expect(api.gitAccess.status).not.toHaveBeenCalled()
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument()
  })

  it('warns when enabled and installs after a click confirmation', async () => {
    vi.mocked(api.gitAccess.install).mockResolvedValue(okStatus)
    renderPanel(plainHost)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable git access on this host' }))
    expect(screen.getByText(WARNING)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('checkbox', { name: /github.com\/acme/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    const dialog = screen.getByRole('alertdialog')
    expect(api.gitAccess.install).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install' }))
    await waitFor(() =>
      expect(api.gitAccess.install).toHaveBeenCalledWith('h1', ['t1'], { pathBlock: false })
    )
    expect(refresh).toHaveBeenCalled()
  })

  it('asks before editing ~/.bashrc on first install and passes the answer', async () => {
    vi.mocked(api.gitAccess.install).mockResolvedValue(okStatus)
    renderPanel(plainHost)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable git access on this host' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /github.com\/acme/ }))
    const pathBox = screen.getByRole('checkbox', { name: PATH_BOX })
    expect(pathBox).not.toBeChecked()
    fireEvent.click(pathBox)
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/top of ~\/\.bashrc/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install' }))
    await waitFor(() =>
      expect(api.gitAccess.install).toHaveBeenCalledWith('h1', ['t1'], { pathBlock: true })
    )
  })

  it('hides the PATH question when non-login shells already find the wrapper', async () => {
    renderPanel(installedHost)
    await screen.findByText('Active in non-login shells')
    expect(screen.queryByRole('checkbox', { name: PATH_BOX })).not.toBeInTheDocument()
  })

  it('offers the PATH question on Update host when non-login shells miss the wrapper', async () => {
    const notActive = { ...okStatus, wrapper: { ...okStatus.wrapper, nonLoginShell: false } }
    vi.mocked(api.gitAccess.status).mockResolvedValue(notActive)
    vi.mocked(api.gitAccess.install).mockResolvedValue(okStatus)
    renderPanel(installedHost)
    fireEvent.click(await screen.findByRole('checkbox', { name: PATH_BOX }))
    fireEvent.click(screen.getByRole('button', { name: 'Update host' }))
    await waitFor(() =>
      expect(api.gitAccess.install).toHaveBeenCalledWith('h1', ['t1'], { pathBlock: true })
    )
  })

  it('reports the PATH block state and never offers to edit a symlinked ~/.bashrc', async () => {
    const symlinked: GitAccessStatus = {
      ...okStatus,
      wrapper: { ...okStatus.wrapper, nonLoginShell: false },
      pathBlock: 'symlink'
    }
    vi.mocked(api.gitAccess.status).mockResolvedValue(symlinked)
    renderPanel(installedHost)
    expect(
      await screen.findByText(
        "~/.bashrc is a symlink, so remodeck didn't edit it. Put ~/.local/bin first in PATH yourself"
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: PATH_BOX })).not.toBeInTheDocument()
  })

  it('shows when remodeck added the PATH line', async () => {
    vi.mocked(api.gitAccess.status).mockResolvedValue({ ...okStatus, pathBlock: 'present' })
    renderPanel(installedHost)
    expect(await screen.findByText('PATH line in ~/.bashrc added by remodeck')).toBeInTheDocument()
  })

  it('shows an empty state when there are no tokens', async () => {
    vi.mocked(api.gitTokens.list).mockResolvedValue([])
    renderPanel(plainHost)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable git access on this host' }))
    expect(await screen.findByText('No tokens yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manage tokens' })).toBeInTheDocument()
  })

  it('Manage tokens closes the surrounding dialog before opening Settings', async () => {
    vi.mocked(api.gitTokens.list).mockResolvedValue([])
    const onClose = vi.fn()
    renderPanel(plainHost, [plainHost], onClose)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable git access on this host' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Manage tokens' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('loads status for an installed host and pre-checks installed tokens', async () => {
    vi.mocked(api.gitAccess.status).mockResolvedValue({ ...okStatus, stale: ['t1'] })
    renderPanel(installedHost)
    await waitFor(() => expect(api.gitAccess.status).toHaveBeenCalledWith('h1'))
    const acme = await screen.findByRole('checkbox', { name: /github.com\/acme/ })
    expect(acme).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /github.com\/other/ })).not.toBeChecked()
    expect(await screen.findByText('Changed since install')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update host' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Update host' }))
    await waitFor(() =>
      expect(api.gitAccess.install).toHaveBeenCalledWith('h1', ['t1'], { pathBlock: false })
    )
  })

  it('reports cli, wrapper and helper problems', async () => {
    vi.mocked(api.gitAccess.status).mockResolvedValue({
      ...okStatus,
      cli: { path: null, version: null },
      wrapper: {
        state: 'ours',
        version: 0,
        outdated: true,
        loginShell: true,
        nonLoginShell: false
      },
      otherHelpers: ['store'],
      helperOrder: 'behind'
    })
    renderPanel(installedHost)
    expect(await screen.findByText('gh not found on this host')).toBeInTheDocument()
    expect(screen.getByText('Update available')).toBeInTheDocument()
    expect(screen.getByText(/Put ~\/\.local\/bin first in PATH/)).toBeInTheDocument()
    expect(
      screen.getByText(
        'Credential helper "store" for github.com is asked before remodeck\'s and may answer with its own login. Repos without a remodeck token may also stop using it.'
      )
    ).toBeInTheDocument()
  })

  it('hides the helper question when no other helper is configured', async () => {
    renderPanel(installedHost)
    await screen.findByText('Active in non-login shells')
    expect(screen.queryByRole('checkbox', { name: HELPER_BOX })).not.toBeInTheDocument()
  })

  it('asks to put remodeck first when gh answers before it, and passes the answer', async () => {
    vi.mocked(api.gitAccess.status).mockResolvedValue({
      ...okStatus,
      otherHelpers: ['gh'],
      helperOrder: 'behind'
    })
    vi.mocked(api.gitAccess.install).mockResolvedValue(okStatus)
    renderPanel(installedHost)
    const box = await screen.findByRole('checkbox', { name: HELPER_BOX })
    expect(box).not.toBeChecked()
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Update host' }))
    await waitFor(() =>
      expect(api.gitAccess.install).toHaveBeenCalledWith('h1', ['t1'], {
        pathBlock: false,
        helperFirst: true
      })
    )
  })

  it('shows the saved choice ticked and lets the user turn it off', async () => {
    vi.mocked(api.gitAccess.status).mockResolvedValue({ ...okStatus, otherHelpers: ['gh'] })
    vi.mocked(api.gitAccess.install).mockResolvedValue(okStatus)
    const host: Host = {
      ...installedHost,
      gitAccess: { ...installedHost.gitAccess!, helperFirst: true }
    }
    renderPanel(host)
    expect(
      await screen.findByText(
        'Credential helper "gh" for github.com is asked after remodeck\'s, for repos without a remodeck token'
      )
    ).toBeInTheDocument()
    const box = screen.getByRole('checkbox', { name: HELPER_BOX })
    expect(box).toBeChecked()
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'Update host' }))
    await waitFor(() =>
      expect(api.gitAccess.install).toHaveBeenCalledWith('h1', ['t1'], {
        pathBlock: false,
        helperFirst: false
      })
    )
  })

  it('reports a helper reset that hides remodeck', async () => {
    vi.mocked(api.gitAccess.status).mockResolvedValue({
      ...okStatus,
      otherHelpers: ['gh'],
      helperOrder: 'missing'
    })
    renderPanel(installedHost)
    expect(await screen.findByText(/hides remodeck's helper/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: HELPER_BOX })).toBeInTheDocument()
  })

  it('renders a row for a stale token that was deleted in Settings', async () => {
    vi.mocked(api.gitAccess.status).mockResolvedValue({ ...okStatus, stale: ['gone'] })
    renderPanel(installedHost)
    expect(
      await screen.findByText(
        'A removed token is still on this host. Update host or Remove from host deletes it.'
      )
    ).toBeInTheDocument()
  })

  it('reloads the token list when the host gains git access', async () => {
    let hosts: Host[] = [plainHost]
    const view = (): React.JSX.Element => (
      <AppStateContext.Provider value={{ refresh, hosts } as unknown as AppState}>
        <HostGitAccessPanel host={plainHost} />
      </AppStateContext.Provider>
    )
    const { rerender } = render(view())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable git access on this host' }))
    await screen.findByRole('checkbox', { name: /github.com\/acme/ })
    const calls = vi.mocked(api.gitTokens.list).mock.calls.length
    hosts = [installedHost]
    rerender(view())
    await waitFor(() => expect(vi.mocked(api.gitTokens.list).mock.calls.length).toBe(calls + 1))
  })

  it('offers Remove from host after a failed first install on a plain host', async () => {
    vi.mocked(api.gitAccess.install).mockRejectedValue(new Error('boom'))
    vi.mocked(api.gitAccess.remove).mockResolvedValue(undefined as never)
    renderPanel(plainHost)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable git access on this host' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /github.com\/acme/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Install' })
    )
    expect(
      await screen.findByText('boom Try Update host again or Remove from host.')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove from host' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api.gitAccess.remove).toHaveBeenCalledWith('h1'))
  })

  it('reports a foreign gh wrapper', async () => {
    vi.mocked(api.gitAccess.status).mockResolvedValue({
      ...okStatus,
      wrapper: {
        state: 'foreign',
        version: null,
        outdated: false,
        loginShell: false,
        nonLoginShell: false
      }
    })
    renderPanel(installedHost)
    expect(
      await screen.findByText('gh wrapper not installed: ~/.local/bin/gh already exists')
    ).toBeInTheDocument()
  })

  it('removes after confirmation and refreshes', async () => {
    vi.mocked(api.gitAccess.remove).mockResolvedValue(undefined as never)
    renderPanel(installedHost)
    await screen.findByRole('checkbox', { name: /github.com\/acme/ })
    fireEvent.click(screen.getByRole('button', { name: 'Remove from host' }))
    expect(api.gitAccess.remove).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api.gitAccess.remove).toHaveBeenCalledWith('h1'))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('checks again and shows a status error inline while staying usable', async () => {
    renderPanel(installedHost)
    await waitFor(() => expect(api.gitAccess.status).toHaveBeenCalledTimes(1))
    vi.mocked(api.gitAccess.status).mockRejectedValue(new Error('ssh failed'))
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('ssh failed')).toBeInTheDocument()
    expect(api.gitAccess.status).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Update host' })).toBeEnabled()
  })

  it('shows an install error and keeps the installed state', async () => {
    vi.mocked(api.gitAccess.install).mockRejectedValue(new Error('probe failed'))
    renderPanel(installedHost)
    await screen.findByRole('checkbox', { name: /github.com\/acme/ })
    fireEvent.click(screen.getByRole('button', { name: 'Update host' }))
    expect(await screen.findByText(/^probe failed Try Update host again/)).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Update host' })).toBeInTheDocument()
  })

  it('keeps the installed state when install fails after the host gained gitAccess', async () => {
    vi.mocked(api.gitAccess.install).mockRejectedValue(
      new Error('Status check failed (exit 1): boom')
    )
    let hosts: Host[] = [plainHost]
    const view = (): React.JSX.Element => (
      <AppStateContext.Provider value={{ refresh, hosts } as unknown as AppState}>
        <HostGitAccessPanel host={plainHost} />
      </AppStateContext.Provider>
    )
    const { rerender } = render(view())
    refresh.mockImplementation(async () => {
      hosts = [installedHost]
      rerender(view())
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable git access on this host' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /github.com\/acme/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Install' })
    )
    expect(
      await screen.findByText(/^Status check failed \(exit 1\): boom Try Update host again/)
    ).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Update host' })).toBeInTheDocument()
    const enable = screen.getByRole('checkbox', { name: 'Enable git access on this host' })
    expect(enable).toBeChecked()
    expect(enable).toBeDisabled()
  })

  it('stays not installed when install fails and the host has no gitAccess', async () => {
    vi.mocked(api.gitAccess.install).mockRejectedValue(new Error('boom'))
    renderPanel(plainHost)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable git access on this host' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /github.com\/acme/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Install' })
    )
    expect(await screen.findByText(/^boom Try Update host again/)).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update host' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Enable git access on this host' })).toBeEnabled()
  })

  it('disables Install until a token is checked', async () => {
    renderPanel(plainHost)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable git access on this host' }))
    const box = await screen.findByRole('checkbox', { name: /github.com\/acme/ })
    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled()
    fireEvent.click(box)
    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled()
  })
})
