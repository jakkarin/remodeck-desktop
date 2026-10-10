import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { GitToken } from '../../src/shared/gitAccess'
import type { Host } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    gitTokens: {
      list: vi.fn(),
      add: vi.fn(),
      replace: vi.fn(),
      setLabel: vi.fn(),
      remove: vi.fn()
    }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { GitTokensSection } from '../../src/renderer/src/components/settings/GitTokensSection'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

function token(over: Partial<GitToken>): GitToken {
  return {
    id: 't',
    provider: 'github',
    host: 'github.com',
    path: 'org-a',
    login: 'octo',
    label: 'Work',
    expiresAt: null,
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over
  }
}

const TOKENS: GitToken[] = [
  token({ id: 't3', path: 'org-b', label: 'Other', expiresAt: '2026-10-01' }),
  token({ id: 't2', path: 'org-a/payments', label: 'Pay', expiresAt: null }),
  token({ id: 't1', path: 'org-a', label: 'Work', expiresAt: '2026-10-12' })
]

function access(installed: Record<string, string>): Host['gitAccess'] {
  return { installedAt: '', installed, wrapperVersion: 1 }
}

function renderSection(hosts: Partial<Host>[] = []): void {
  const value = { hosts } as unknown as AppState
  render(
    <AppStateContext.Provider value={value}>
      <GitTokensSection />
    </AppStateContext.Provider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-09T00:00:00Z'))
  vi.mocked(api.gitTokens.list).mockResolvedValue(TOKENS)
})
afterEach(() => vi.useRealTimers())

describe('GitTokensSection', () => {
  it('lists tokens in scope order with expiry badges and host counts', async () => {
    renderSection([
      { id: 'h1', label: 'Box', gitAccess: access({ t1: 'x' }) },
      { id: 'h2', label: 'Sandbox 2', gitAccess: access({ t1: 'x', t2: 'y' }) }
    ])
    const rows = await screen.findAllByRole('listitem')
    expect(rows.map((r) => within(r).getByTestId('scope').textContent)).toEqual([
      'github.com/org-a',
      'github.com/org-a/payments',
      'github.com/org-b'
    ])
    expect(within(rows[0]).getByText('Expires in 3 days')).toHaveClass('badge-warning')
    expect(within(rows[1]).getByText('No expiry')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Expired')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Installed on 2 hosts')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Installed on 1 host')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Not installed')).toBeInTheDocument()
  })

  it('adds a token, clears the password field and reloads', async () => {
    vi.mocked(api.gitTokens.add).mockResolvedValue(token({}))
    renderSection()
    await screen.findAllByRole('listitem')
    const select = screen.getByLabelText('Host') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(['github.com'])
    const input = screen.getByLabelText('Token') as HTMLInputElement
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('autocomplete', 'off')
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: 'org-a' } })
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Work' } })
    fireEvent.change(input, { target: { value: 'tok' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add token' }))
    await waitFor(() =>
      expect(api.gitTokens.add).toHaveBeenCalledWith({
        host: 'github.com',
        path: 'org-a',
        label: 'Work',
        token: 'tok'
      })
    )
    await waitFor(() => expect(input.value).toBe(''))
    expect(api.gitTokens.list).toHaveBeenCalledTimes(2)
  })

  it('shows the error inline and clears the token after a failed add', async () => {
    vi.mocked(api.gitTokens.add).mockRejectedValue(new Error('Token is invalid or expired'))
    renderSection()
    await screen.findAllByRole('listitem')
    const input = screen.getByLabelText('Token') as HTMLInputElement
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: 'org-a' } })
    fireEvent.change(input, { target: { value: 'tok' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add token' }))
    expect(await screen.findByText('Token is invalid or expired')).toBeInTheDocument()
    expect(input.value).toBe('')
  })

  it('replaces a token with host and path read-only', async () => {
    vi.mocked(api.gitTokens.replace).mockResolvedValue(token({}))
    renderSection()
    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getByRole('button', { name: 'Replace token for github.com/org-a' }))
    expect(screen.getByLabelText('Host')).toBeDisabled()
    expect(screen.getByLabelText('Path')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Path')).toHaveValue('org-a')
    fireEvent.change(screen.getByLabelText('Token'), { target: { value: 'new' } })
    fireEvent.click(screen.getByRole('button', { name: 'Replace token' }))
    await waitFor(() => expect(api.gitTokens.replace).toHaveBeenCalledWith('t1', 'new'))
    expect(api.gitTokens.add).not.toHaveBeenCalled()
  })

  it('names the hosts a token is still installed on before removing', async () => {
    vi.mocked(api.gitTokens.remove).mockResolvedValue(undefined as never)
    renderSection([{ id: 'h1', label: 'Box', gitAccess: access({ t1: 'x' }) }])
    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getByRole('button', { name: 'Remove token for github.com/org-a' }))
    expect(screen.getByText('Still installed on: Box')).toBeInTheDocument()
    expect(api.gitTokens.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))
    await waitFor(() => expect(api.gitTokens.remove).toHaveBeenCalledWith('t1'))
  })

  it('returns to the add form when the token being replaced is removed', async () => {
    vi.mocked(api.gitTokens.remove).mockResolvedValue(undefined as never)
    renderSection()
    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getByRole('button', { name: 'Replace token for github.com/org-a' }))
    expect(screen.getByRole('button', { name: 'Replace token' })).toBeInTheDocument()
    vi.mocked(api.gitTokens.list).mockResolvedValue(TOKENS.filter((t) => t.id !== 't1'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove token for github.com/org-a' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))
    expect(await screen.findByRole('button', { name: 'Add token' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Replace token' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Host')).not.toBeDisabled()
  })

  it('shows No expiry for an unparsable expiry date', async () => {
    vi.mocked(api.gitTokens.list).mockResolvedValue([token({ expiresAt: 'garbage' })])
    renderSection()
    expect(await screen.findByText('No expiry')).toBeInTheDocument()
  })

  it('edits a label inline and reloads', async () => {
    vi.mocked(api.gitTokens.setLabel).mockResolvedValue(token({ label: 'Renamed' }))
    renderSection()
    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getByRole('button', { name: 'Edit label for github.com/org-a' }))
    const input = screen.getByRole('textbox', { name: 'Label for github.com/org-a' })
    expect(input).toHaveValue('Work')
    fireEvent.change(input, { target: { value: ' Renamed ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save label' }))
    await waitFor(() => expect(api.gitTokens.setLabel).toHaveBeenCalledWith('t1', 'Renamed'))
    await waitFor(() => expect(api.gitTokens.list).toHaveBeenCalledTimes(2))
    expect(
      screen.queryByRole('textbox', { name: 'Label for github.com/org-a' })
    ).not.toBeInTheDocument()
  })

  it('rejects an empty label inline without calling the API', async () => {
    renderSection()
    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getByRole('button', { name: 'Edit label for github.com/org-a' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Label for github.com/org-a' }), {
      target: { value: '   ' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save label' }))
    expect(await screen.findByText('Label cannot be empty')).toBeInTheDocument()
    expect(api.gitTokens.setLabel).not.toHaveBeenCalled()
  })

  it('tells the user to limit repositories and set an expiration', async () => {
    renderSection()
    await screen.findAllByRole('listitem')
    expect(screen.getByText(/only the repositories/i)).toBeInTheDocument()
    expect(screen.getByText(/expiration/i)).toBeInTheDocument()
  })

  it('explains the required permissions with a link to create a token', async () => {
    renderSection()
    await screen.findAllByRole('listitem')
    expect(screen.getByText(/Contents/)).toBeInTheDocument()
    expect(screen.getByText(/Pull requests/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Create a token/ })).toHaveAttribute(
      'href',
      'https://github.com/settings/personal-access-tokens/new'
    )
  })
})
