import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from '../../src/renderer/src/components/Toaster'
import { Dialog, DialogContent, DialogTitle } from '../../src/renderer/src/components/ui/dialog'
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

describe('Toaster over a modal dialog', () => {
  it('dismissing a toast does not close an open dialog', () => {
    const onOpenChange = vi.fn()
    render(
      <>
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Clone</DialogTitle>
          </DialogContent>
        </Dialog>
        <Toaster />
      </>
    )
    act(() => showToast('Push failed', { tone: 'error' }))
    // Radix arms its outside-interaction listeners on the next tick
    act(() => {
      vi.advanceTimersByTime(10)
    })
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' })
    fireEvent.pointerDown(dismiss)
    fireEvent.click(dismiss)
    expect(getToasts()).toHaveLength(0)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Clone' })).toBeInTheDocument()
  })
})
