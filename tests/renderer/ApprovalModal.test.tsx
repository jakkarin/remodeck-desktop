import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { ApprovalRequest } from '../../src/shared/types'

let handler: ((req: ApprovalRequest) => void) | null = null

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    approval: { respond: vi.fn() },
    on: vi.fn((event: string, cb: (req: ApprovalRequest) => void) => {
      if (event === 'approval-request') handler = cb
      return () => {
        handler = null
      }
    })
  }
}))

import { api } from '../../src/renderer/src/api'
import { ApprovalModal } from '../../src/renderer/src/components/ApprovalModal'
import { AppStateContext, type AppState } from '../../src/renderer/src/state'

const req = (id: string, over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id,
  repoId: 'r1',
  repoLabel: 'acme/api',
  sessionId: 's1',
  tabLabel: `tab-${id}`,
  updates: [
    {
      ref: 'refs/heads/feat',
      oldSha: 'a1b2c3d' + '0'.repeat(33),
      newSha: 'e4f5a6b' + '0'.repeat(33)
    }
  ],
  ...over
})

describe('ApprovalModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    handler = null
  })

  it('renders the update and advances the queue after a decision', () => {
    render(<ApprovalModal />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => {
      handler!(req('1'))
      handler!(req('2'))
    })
    expect(screen.getByText('refs/heads/feat: a1b2c3d → e4f5a6b')).toBeInTheDocument()
    expect(screen.getByText(/tab-1/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Allow for this session'))
    expect(api.approval.respond).toHaveBeenCalledWith('1', 'session')
    expect(screen.getByText(/tab-2/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Deny'))
    expect(api.approval.respond).toHaveBeenCalledWith('2', 'deny')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('maps buttons to decisions and shows (new branch) for zero old sha', () => {
    render(<ApprovalModal />)
    act(() => {
      handler!(
        req('1', {
          updates: [{ ref: 'refs/heads/new', oldSha: '0'.repeat(40), newSha: 'abcdef1234' }]
        })
      )
    })
    expect(screen.getByText('refs/heads/new: (new branch) → abcdef1')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Always allow for this repo'))
    expect(api.approval.respond).toHaveBeenCalledWith('1', 'always')
  })

  it("refreshes app state after 'always' (so Settings shows it), not after 'once'", () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const value = { refresh } as unknown as AppState
    render(
      <AppStateContext.Provider value={value}>
        <ApprovalModal />
      </AppStateContext.Provider>
    )
    act(() => {
      handler!(req('1'))
      handler!(req('2'))
    })
    fireEvent.click(screen.getByText('Allow once'))
    expect(refresh).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Always allow for this repo'))
    expect(api.approval.respond).toHaveBeenCalledWith('2', 'always')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('auto-dismisses a request after 60 seconds', () => {
    vi.useFakeTimers()
    render(<ApprovalModal />)
    act(() => {
      handler!(req('1'))
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.approval.respond).not.toHaveBeenCalled()
  })
})
