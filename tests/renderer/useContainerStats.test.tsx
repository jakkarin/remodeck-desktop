import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ContainerStats } from '../../src/shared/containerDetails'

type Handler = (...args: never[]) => void
const handlers: Record<string, Set<Handler>> = {}

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    containers: { watchStats: vi.fn() },
    on: vi.fn((event: string, cb: Handler) => {
      ;(handlers[event] ??= new Set()).add(cb)
      return () => handlers[event].delete(cb)
    })
  }
}))

import { api } from '../../src/renderer/src/api'
import { useContainerStats } from '../../src/renderer/src/useContainerStats'

const s = (cpu: number): Record<string, ContainerStats> => ({
  c1: { cpu, memBytes: 1, memLimit: 2 }
})
const emit = (event: string, ...args: unknown[]): void =>
  act(() => {
    for (const cb of handlers[event] ?? []) (cb as (...a: unknown[]) => void)(...args)
  })
const setVisibility = (v: 'visible' | 'hidden'): void => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v })
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(handlers)) delete handlers[k]
  setVisibility('visible')
})

describe('useContainerStats', () => {
  it('turns watching on when enabled and off on unmount', () => {
    const { unmount } = renderHook(() => useContainerStats('h1', true))
    expect(api.containers.watchStats).toHaveBeenLastCalledWith('h1', true)
    unmount()
    expect(api.containers.watchStats).toHaveBeenLastCalledWith('h1', false)
  })

  it('does not watch while disabled', () => {
    renderHook(() => useContainerStats('h1', false))
    expect(api.containers.watchStats).not.toHaveBeenCalledWith('h1', true)
  })

  it('turns off when the document is hidden and back on when visible', () => {
    renderHook(() => useContainerStats('h1', true))
    setVisibility('hidden')
    expect(api.containers.watchStats).toHaveBeenLastCalledWith('h1', false)
    setVisibility('visible')
    expect(api.containers.watchStats).toHaveBeenLastCalledWith('h1', true)
  })

  it('ignores other hosts stats and clears them on host change', () => {
    const { result, rerender } = renderHook(({ id }) => useContainerStats(id, true), {
      initialProps: { id: 'h1' }
    })
    emit('containers-stats', 'h2', s(9))
    expect(result.current).toEqual({})
    emit('containers-stats', 'h1', s(3))
    expect(result.current).toEqual(s(3))
    rerender({ id: 'h2' })
    expect(result.current).toEqual({})
    expect(api.containers.watchStats).toHaveBeenCalledWith('h1', false)
    expect(api.containers.watchStats).toHaveBeenLastCalledWith('h2', true)
  })
})
