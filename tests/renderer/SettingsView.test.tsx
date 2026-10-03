import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Repo } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    repos: { updatePolicy: vi.fn().mockResolvedValue({}) },
    pushLog: {
      read: vi.fn().mockResolvedValue([
        {
          time: '2026-10-03T10:00:00Z',
          repo: 'acme/api',
          workspaceId: 'w1',
          channel: 'review',
          updates: [{ ref: 'refs/heads/feat', oldSha: 'a', newSha: 'b' }],
          result: 'blocked',
          detail: 'protected branch'
        }
      ])
    }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { SettingsView } from '../../src/renderer/src/components/SettingsView'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

const refresh = vi.fn().mockResolvedValue(undefined)

function renderWith(repo: Partial<Repo> = {}): void {
  const value: AppState = {
    hosts: [],
    statuses: {},
    repos: [
      {
        id: 'r1',
        owner: 'acme',
        name: 'api',
        defaultBranch: 'main',
        protectedBranches: ['main'],
        alwaysAllowPush: true,
        enforceRules: false,
        ...repo
      }
    ],
    workspaces: [],
    selected: { kind: 'settings' },
    select: vi.fn(),
    setStatus: vi.fn(),
    refresh
  }
  render(
    <AppStateContext.Provider value={value}>
      <SettingsView />
    </AppStateContext.Provider>
  )
}

describe('SettingsView', () => {
  beforeEach(() => vi.clearAllMocks())

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

  it('renders the push log', async () => {
    renderWith()
    expect(await screen.findByText('protected branch')).toBeInTheDocument()
    expect(screen.getByText('blocked')).toBeInTheDocument()
    expect(api.pushLog.read).toHaveBeenCalledWith(200)
  })
})
