import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from '../../src/renderer/src/components/Toaster'
import { dismissToast, getToasts, showToast } from '../../src/renderer/src/toast'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  act(() => {
    for (const t of getToasts()) dismissToast(t.id)
  })
  vi.useRealTimers()
})

describe('Toaster', () => {
  it('success toasts auto-dismiss after 4 s', () => {
    render(<Toaster />)
    act(() => showToast('Pushed'))
    expect(screen.getByRole('status')).toHaveTextContent('Pushed')
    act(() => {
      vi.advanceTimersByTime(4100)
    })
    expect(getToasts()).toHaveLength(0)
  })

  it('error toasts stay until dismissed', () => {
    render(<Toaster />)
    act(() => showToast('Push failed', { tone: 'error', message: 'rejected' }))
    act(() => {
      vi.advanceTimersByTime(60000)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Push failed')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(getToasts()).toHaveLength(0)
  })

  it('hovering a success toast pauses its countdown', () => {
    render(<Toaster />)
    act(() => showToast('Pushed'))
    fireEvent.mouseEnter(screen.getByRole('status'))
    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(getToasts()).toHaveLength(1)
    fireEvent.mouseLeave(screen.getByRole('status'))
    act(() => {
      vi.advanceTimersByTime(4100)
    })
    expect(getToasts()).toHaveLength(0)
  })
})
