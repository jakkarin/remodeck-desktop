import { describe, expect, it, vi } from 'vitest'
import { startStatsLoop } from '../../../src/main/docker/statsLoop'

const stats = (cpuTotal: number): unknown => ({
  cpu_stats: {
    cpu_usage: { total_usage: cpuTotal },
    system_cpu_usage: 2000,
    online_cpus: 1
  },
  precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 1000 },
  memory_stats: { usage: 1000, limit: 4000 }
})

function sleeper(): { sleep: ReturnType<typeof vi.fn>; release: () => void } {
  const waits: Array<() => void> = []
  const sleep = vi.fn(() => new Promise<void>((r) => waits.push(r)))
  return { sleep, release: () => waits.shift()?.() }
}

describe('startStatsLoop', () => {
  it('polls running ids one at a time and emits the map', async () => {
    let pending = 0
    let maxPending = 0
    const json = vi.fn(async () => {
      maxPending = Math.max(maxPending, ++pending)
      await Promise.resolve()
      pending--
      return stats(100)
    })
    const emit = vi.fn()
    const s = sleeper()
    const loop = startStatsLoop({
      client: { json } as never,
      runningIds: () => ['a', 'b'],
      emit,
      sleep: s.sleep
    })
    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(1))
    loop.stop()
    expect(maxPending).toBe(1)
    expect(json).toHaveBeenCalledWith('GET', '/containers/a/stats?stream=false', undefined, {
      timeoutMs: 10000
    })
    expect(json).toHaveBeenCalledWith('GET', '/containers/b/stats?stream=false', undefined, {
      timeoutMs: 10000
    })
    const map = emit.mock.calls[0][0]
    expect(Object.keys(map)).toEqual(['a', 'b'])
    expect(map.a).toEqual({ cpu: 10, memBytes: 1000, memLimit: 4000 })
  })

  it('skips an id whose request rejects or whose stats are malformed', async () => {
    const json = vi.fn(async (_m: string, path: string) => {
      if (path.includes('/bad/')) throw new Error('boom')
      if (path.includes('/junk/')) return { nope: true }
      return stats(100)
    })
    const emit = vi.fn()
    const loop = startStatsLoop({
      client: { json } as never,
      runningIds: () => ['bad', 'junk', 'ok'],
      emit,
      sleep: sleeper().sleep
    })
    await vi.waitFor(() => expect(emit).toHaveBeenCalled())
    loop.stop()
    expect(Object.keys(emit.mock.calls[0][0])).toEqual(['ok'])
  })

  it('waits 5000 between cycles and re-reads runningIds each cycle', async () => {
    const json = vi.fn(async () => stats(100))
    const emit = vi.fn()
    const s = sleeper()
    const ids = [['a'], ['b']]
    let i = 0
    const runningIds = vi.fn(() => ids[Math.min(i++, 1)])
    const loop = startStatsLoop({ client: { json } as never, runningIds, emit, sleep: s.sleep })
    await vi.waitFor(() => expect(s.sleep).toHaveBeenCalledTimes(1))
    expect(s.sleep).toHaveBeenCalledWith(5000)
    expect(emit).toHaveBeenCalledTimes(1)
    s.release()
    await vi.waitFor(() => expect(emit).toHaveBeenCalledTimes(2))
    loop.stop()
    expect(Object.keys(emit.mock.calls[1][0])).toEqual(['b'])
    expect(runningIds).toHaveBeenCalledTimes(2)
  })

  it('stop() during a cycle prevents emit and further requests', async () => {
    let release!: () => void
    const json = vi.fn(
      () =>
        new Promise((r) => {
          release = () => r(stats(100))
        })
    )
    const emit = vi.fn()
    const loop = startStatsLoop({
      client: { json } as never,
      runningIds: () => ['a', 'b'],
      emit,
      sleep: sleeper().sleep
    })
    await vi.waitFor(() => expect(json).toHaveBeenCalledTimes(1))
    loop.stop()
    release()
    await new Promise((r) => setTimeout(r, 10))
    expect(json).toHaveBeenCalledTimes(1)
    expect(emit).not.toHaveBeenCalled()
  })
})
