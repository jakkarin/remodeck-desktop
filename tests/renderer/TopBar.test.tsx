import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { HostStatus, SyncInfo } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    hosts: {
      connect: vi.fn(),
      disconnect: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
      status: vi.fn()
    },
    repos: { listGitHub: vi.fn().mockResolvedValue([]) },
    workspaces: { clone: vi.fn(), remove: vi.fn(), rebuildMirror: vi.fn(), sync: vi.fn() }
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { TopBar } from '../../src/renderer/src/components/TopBar'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

const NOW = 1_000_000_000

function renderBar(
  status: HostStatus,
  syncInfo: Record<string, SyncInfo> = {},
  onOpenSettings = vi.fn()
): void {
  const value: AppState = {
    hosts: [{ id: 'h1', sshHost: 'a', label: 'Alpha', protected: false }],
    statuses: { h1: status },
    repos: [],
    workspaces: [{ id: 'w1', repoId: 'r1', hostId: 'h1', sandboxPath: '~/repos/api' }],
    activeWorkspaceId: 'w1',
    selectWorkspace: vi.fn(),
    syncInfo,
    setStatus: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined)
  }
  render(
    <AppStateContext.Provider value={value}>
      <TopBar onOpenSettings={onOpenSettings} now={() => NOW} />
    </AppStateContext.Provider>
  )
}

const up: HostStatus = { state: 'connected', warnings: [] }

beforeEach(() => vi.clearAllMocks())

describe('TopBar', () => {
  it('shows plain Sync without sync info', () => {
    renderBar(up)
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument()
  })

  it('shows seconds since last sync', () => {
    renderBar(up, { w1: { kind: 'light', at: NOW - 12_000 } })
    expect(screen.getByRole('button', { name: 'Sync · 12s' })).toBeInTheDocument()
  })

  it.each([
    [5 * 60_000, 'Sync · 5m'],
    [3 * 3_600_000, 'Sync · 3h']
  ])('formats %i ms as %s', (ms, label) => {
    renderBar(up, { w1: { kind: 'full', at: NOW - ms } })
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  })

  it('warns with the error as title when the last sync failed', () => {
    renderBar(up, { w1: { kind: 'light', at: NOW - 1000, error: 'fetch พัง' } })
    const btn = screen.getByRole('button', { name: /Sync/ })
    expect(btn).toHaveClass('warn')
    expect(btn).toHaveAttribute('title', 'fetch พัง')
  })

  it('clicking Sync calls api.workspaces.sync and spins while pending', async () => {
    let done: (v: { rewritten: string[] }) => void = () => undefined
    vi.mocked(api.workspaces.sync).mockReturnValue(
      new Promise((r) => {
        done = r
      })
    )
    renderBar(up)
    const btn = screen.getByRole('button', { name: 'Sync' })
    fireEvent.click(btn)
    expect(api.workspaces.sync).toHaveBeenCalledWith('w1')
    expect(btn.querySelector('svg')).toHaveClass('spinning')
    done({ rewritten: [] })
    await waitFor(() => expect(btn.querySelector('svg')).not.toHaveClass('spinning'))
  })

  it('shows the error banner when sync rejects', async () => {
    vi.mocked(api.workspaces.sync).mockRejectedValue(new Error('sync ล้มเหลว'))
    renderBar(up)
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(await screen.findByText('sync ล้มเหลว')).toBeInTheDocument()
  })

  it.each(['disconnected', 'error'] as const)('disables Sync when the host is %s', (state) => {
    renderBar({ state, warnings: [] })
    const btn = screen.getByRole('button', { name: 'Sync' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', 'Host ยังไม่ได้ connect')
  })

  it('settings button calls onOpenSettings', () => {
    const open = vi.fn()
    renderBar(up, {}, open)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(open).toHaveBeenCalled()
  })
})
