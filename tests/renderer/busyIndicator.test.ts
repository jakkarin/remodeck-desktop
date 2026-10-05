import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createBusyIndicator } from '../../src/renderer/src/busyIndicator'

describe('createBusyIndicator', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('never shows for a fast operation', () => {
    const on = vi.fn()
    const b = createBusyIndicator(on)
    const end = b.begin()
    vi.advanceTimersByTime(299)
    end()
    vi.advanceTimersByTime(1000)
    expect(on).not.toHaveBeenCalled()
  })

  it('shows at 300ms and stays until min visible time has passed', () => {
    const on = vi.fn()
    const b = createBusyIndicator(on)
    const end = b.begin()
    vi.advanceTimersByTime(300)
    expect(on).toHaveBeenLastCalledWith(true)
    vi.advanceTimersByTime(50)
    end()
    vi.advanceTimersByTime(249)
    expect(on).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(on).toHaveBeenLastCalledWith(false)
  })

  it('hides immediately when already visible long enough', () => {
    const on = vi.fn()
    const b = createBusyIndicator(on)
    const end = b.begin()
    vi.advanceTimersByTime(700)
    end()
    expect(on).toHaveBeenLastCalledWith(false)
  })

  it('stays visible while overlapping operations run', () => {
    const on = vi.fn()
    const b = createBusyIndicator(on)
    const e1 = b.begin()
    vi.advanceTimersByTime(200)
    const e2 = b.begin()
    vi.advanceTimersByTime(100)
    expect(on).toHaveBeenLastCalledWith(true)
    e1()
    vi.advanceTimersByTime(1000)
    expect(on).toHaveBeenCalledTimes(1)
    e2()
    vi.advanceTimersByTime(300)
    expect(on).toHaveBeenLastCalledWith(false)
    e2()
  })

  it('dispose clears pending timers', () => {
    const on = vi.fn()
    const b = createBusyIndicator(on)
    b.begin()
    b.dispose()
    vi.advanceTimersByTime(1000)
    expect(on).not.toHaveBeenCalled()
  })
})
