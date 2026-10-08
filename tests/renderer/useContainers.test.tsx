import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ContainerInfo } from '../../src/shared/containers'

type Handler = (...args: never[]) => void
const handlers: Record<string, Set<Handler>> = {}

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    containers: { open: vi.fn(), action: vi.fn() },
    on: vi.fn((event: string, cb: Handler) => {
      ;(handlers[event] ??= new Set()).add(cb)
      return () => handlers[event].delete(cb)
    })
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { useContainers } from '../../src/renderer/src/useContainers'

const mk = (name: string): ContainerInfo => ({
  id: name.padEnd(12, '0'),
  name,
  image: 'img',
  imageId: '',
  state: 'running',
  status: 'Up',
  created: 0,
  ports: [],
  volumes: [],
  networks: [],
  compose: null
})
type Open = { list: ContainerInfo[]; live: boolean }
const res = (list: ContainerInfo[], live = true): Open => ({ list, live })
const emit = (event: string, ...args: unknown[]): void =>
  act(() => {
    for (const cb of handlers[event] ?? []) (cb as (...a: unknown[]) => void)(...args)
  })

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(handlers)) delete handlers[k]
})

describe('useContainers', () => {
  it('shows the open result and is live', async () => {
    vi.mocked(api.containers.open).mockResolvedValue(res([mk('a')]))
    const { result } = renderHook(() => useContainers('h1'))
    expect(result.current.list).toBeNull()
    await waitFor(() => expect(result.current.list).toEqual([mk('a')]))
    expect(result.current.live).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('applies containers-changed for the same host only', async () => {
    vi.mocked(api.containers.open).mockResolvedValue(res([mk('a')]))
    const { result } = renderHook(() => useContainers('h1'))
    await waitFor(() => expect(result.current.list).not.toBeNull())
    emit('containers-changed', 'h2', [mk('x')])
    expect(result.current.list).toEqual([mk('a')])
    emit('containers-changed', 'h1', [mk('b')])
    expect(result.current.list).toEqual([mk('b')])
  })

  it('ignores a stale open result after switching host', async () => {
    let resolveFirst: (l: Open) => void = () => {}
    vi.mocked(api.containers.open)
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce(res([mk('second')]))
    const { result, rerender } = renderHook(({ id }) => useContainers(id), {
      initialProps: { id: 'h1' }
    })
    rerender({ id: 'h2' })
    await waitFor(() => expect(result.current.list).toEqual([mk('second')]))
    await act(async () => resolveFirst(res([mk('first')])))
    expect(result.current.list).toEqual([mk('second')])
  })

  it('flips live on containers-live for this host', async () => {
    vi.mocked(api.containers.open).mockResolvedValue(res([]))
    const { result } = renderHook(() => useContainers('h1'))
    await waitFor(() => expect(result.current.live).toBe(true))
    emit('containers-live', 'h2', false)
    expect(result.current.live).toBe(true)
    emit('containers-live', 'h1', false)
    expect(result.current.live).toBe(false)
  })

  it('reports open errors and retries', async () => {
    vi.mocked(api.containers.open).mockRejectedValueOnce(new Error('denied'))
    const { result } = renderHook(() => useContainers('h1'))
    await waitFor(() => expect(result.current.error).toBe('denied'))
    vi.mocked(api.containers.open).mockResolvedValueOnce(res([mk('a')]))
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.list).toEqual([mk('a')]))
    expect(result.current.error).toBeNull()
  })

  it('keeps a newer containers-changed list over a late open result', async () => {
    let resolveOpen: (l: Open) => void = () => {}
    vi.mocked(api.containers.open).mockImplementationOnce(
      () => new Promise((r) => (resolveOpen = r))
    )
    const { result } = renderHook(() => useContainers('h1'))
    emit('containers-changed', 'h1', [mk('new')])
    await act(async () => resolveOpen(res([mk('old')])))
    expect(result.current.list).toEqual([mk('new')])
    expect(result.current.live).toBe(true)
  })

  it('does not expose host A data under host B, and re-opens A on return', async () => {
    let resolveB: (l: Open) => void = () => {}
    vi.mocked(api.containers.open)
      .mockResolvedValueOnce(res([mk('a')]))
      .mockImplementationOnce(() => new Promise((r) => (resolveB = r)))
      .mockResolvedValueOnce(res([mk('a2')]))
    const { result, rerender } = renderHook(({ id }) => useContainers(id), {
      initialProps: { id: 'h1' }
    })
    await waitFor(() => expect(result.current.list).toEqual([mk('a')]))
    rerender({ id: 'h2' })
    expect(result.current.list).toBeNull()
    rerender({ id: 'h1' })
    expect(result.current.list).toBeNull()
    await waitFor(() => expect(result.current.list).toEqual([mk('a2')]))
    await act(async () => resolveB(res([mk('b')])))
    expect(result.current.list).toEqual([mk('a2')])
    expect(api.containers.open).toHaveBeenCalledTimes(3)
  })

  it('starts not live and takes live from the open result', async () => {
    vi.mocked(api.containers.open).mockResolvedValue(res([mk('a')], false))
    const { result } = renderHook(() => useContainers('h1'))
    expect(result.current.live).toBe(false)
    await waitFor(() => expect(result.current.list).toEqual([mk('a')]))
    expect(result.current.live).toBe(false)
    emit('containers-live', 'h1', true)
    expect(result.current.live).toBe(true)
  })

  it('a live event received while open is pending beats the open reply', async () => {
    let resolveOpen: (l: Open) => void = () => {}
    vi.mocked(api.containers.open).mockImplementationOnce(
      () => new Promise((r) => (resolveOpen = r))
    )
    const { result } = renderHook(() => useContainers('h1'))
    emit('containers-live', 'h1', true)
    await act(async () => resolveOpen(res([mk('a')], false)))
    expect(result.current.live).toBe(true)
  })
})
