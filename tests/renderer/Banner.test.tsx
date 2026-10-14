import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Banner } from '../../src/renderer/src/components/Banner'
import { rebuildAction } from '../../src/renderer/src/components/rebuildAction'

describe('Banner', () => {
  it('renders children and the action', () => {
    render(
      <Banner tone="danger" action={<button>Retry</button>}>
        Something broke
      </Banner>
    )
    expect(screen.getByText('Something broke')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('dismiss calls onDismiss and has no dismiss button without it', () => {
    const onDismiss = vi.fn()
    const { rerender } = render(
      <Banner tone="warning" onDismiss={onDismiss}>
        Careful
      </Banner>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    rerender(<Banner tone="warning">Careful</Banner>)
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
  })

  it('rebuildAction only offers a rebuild for git errors', () => {
    const onRebuild = vi.fn()
    expect(rebuildAction('timed out', onRebuild)).toBeUndefined()
    expect(rebuildAction('fatal: bad object', undefined)).toBeUndefined()
    render(<>{rebuildAction('git failed', onRebuild)}</>)
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild mirror' }))
    expect(onRebuild).toHaveBeenCalled()
  })
})
