import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DEFAULT_PREFS } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: { hosts: { update: vi.fn() } },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { HostSettingsDialog } from '../../src/renderer/src/components/HostSettingsDialog'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

beforeEach(() => vi.clearAllMocks())

describe('HostSettingsDialog', () => {
  it('saves the label and the protected flag together', async () => {
    vi.mocked(api.hosts.update).mockResolvedValue(undefined as never)
    const onClose = vi.fn()
    const value = {
      refresh: vi.fn().mockResolvedValue(undefined),
      prefs: DEFAULT_PREFS
    } as unknown as AppState
    render(
      <AppStateContext.Provider value={value}>
        <HostSettingsDialog
          host={{ id: 'h1', sshHost: 'box', label: 'Box', protected: false }}
          onClose={onClose}
        />
      </AppStateContext.Provider>
    )
    const hint = screen.getByText('Require typing the host name before dangerous commands')
    expect(hint).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Protected host' })).toHaveAccessibleDescription(
      hint.textContent as string
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /Protected host/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.hosts.update).toHaveBeenCalledWith('h1', { label: 'Box', protected: true })
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('is a named dialog that Escape closes', () => {
    const onClose = vi.fn()
    const value = {
      refresh: vi.fn(),
      hosts: [],
      prefs: DEFAULT_PREFS
    } as unknown as AppState
    render(
      <AppStateContext.Provider value={value}>
        <HostSettingsDialog
          host={{ id: 'h1', sshHost: 'box', label: 'Box', protected: false }}
          onClose={onClose}
        />
      </AppStateContext.Provider>
    )
    const dialog = screen.getByRole('dialog', { name: /Host settings/ })
    expect(screen.getByRole('textbox', { name: 'SSH host' })).toHaveValue('box')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
