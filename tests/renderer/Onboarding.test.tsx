import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Onboarding } from '../../src/renderer/src/components/Onboarding'

describe('Onboarding', () => {
  it('renders the three steps in order', () => {
    render(<Onboarding onAddHost={() => undefined} />)
    expect(screen.getByRole('heading', { name: 'Add your first sandbox' })).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]).getByText('An SSH alias that works')).toBeInTheDocument()
    expect(within(items[1]).getByText('git on the sandbox')).toBeInTheDocument()
    expect(within(items[2]).getByText('GitHub login on this PC')).toBeInTheDocument()
    expect(within(items[2]).getByText('git credential-manager github login')).toBeInTheDocument()
  })

  it('Add host calls onAddHost', () => {
    const onAddHost = vi.fn()
    render(<Onboarding onAddHost={onAddHost} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add host' }))
    expect(onAddHost).toHaveBeenCalledTimes(1)
  })
})
