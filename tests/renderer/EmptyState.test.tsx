import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DEFAULT_PREFS } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: { hosts: { connect: vi.fn() } },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { EmptyState } from '../../src/renderer/src/components/EmptyState'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

describe('EmptyState on This computer', () => {
  it('offers Clone and Add existing for this computer instead of onboarding', () => {
    const value = {
      hosts: [
        { id: 'local', kind: 'local', sshHost: '', label: 'This computer', protected: false }
      ],
      statuses: { local: { state: 'connected' } },
      activeHostId: 'local',
      refresh: vi.fn(),
      selectWorkspace: vi.fn(),
      prefs: DEFAULT_PREFS
    } as unknown as AppState
    render(
      <AppStateContext.Provider value={value}>
        <EmptyState />
      </AppStateContext.Provider>
    )
    expect(
      screen.getByText('Clone from GitHub, or add a repo already on this computer.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add existing repo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add host/ })).toBeNull()
  })
})
