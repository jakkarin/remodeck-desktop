import { describe, expect, it, vi } from 'vitest'
import { ProbeCache } from '../../src/main/connection/probeCache'

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('ProbeCache', () => {
  it('caches until force', async () => {
    const c = new ProbeCache<number>()
    const run = vi.fn(async () => 1)
    expect(await c.get('h', false, run)).toBe(1)
    expect(await c.get('h', false, run)).toBe(1)
    expect(run).toHaveBeenCalledTimes(1)
    await c.get('h', true, run)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('caches a null result too', async () => {
    const c = new ProbeCache<null>()
    const run = vi.fn(async () => null)
    await c.get('h', false, run)
    await c.get('h', false, run)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent calls', async () => {
    const c = new ProbeCache<number>()
    const d = deferred<number>()
    const run = vi.fn(() => d.promise)
    const a = c.get('h', false, run)
    const b = c.get('h', false, run)
    d.resolve(7)
    expect(await Promise.all([a, b])).toEqual([7, 7])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed run', async () => {
    const c = new ProbeCache<number>()
    await expect(c.get('h', false, async () => Promise.reject(new Error('x')))).rejects.toThrow('x')
    expect(await c.get('h', false, async () => 2)).toBe(2)
  })

  it('a forced run wins over an older in-flight run', async () => {
    const c = new ProbeCache<number>()
    const d1 = deferred<number>()
    const d2 = deferred<number>()
    const a = c.get('h', false, () => d1.promise)
    const b = c.get('h', true, () => d2.promise)
    d2.resolve(2)
    await b
    d1.resolve(1)
    await a
    expect(await c.get('h', false, async () => 99)).toBe(2)
  })

  it('clear drops a result still in flight', async () => {
    const c = new ProbeCache<number>()
    const d = deferred<number>()
    const a = c.get('h', false, () => d.promise)
    c.clear('h')
    d.resolve(1)
    await a
    expect(await c.get('h', false, async () => 5)).toBe(5)
  })

  it('exposes current() to the run', async () => {
    const c = new ProbeCache<boolean>()
    expect(
      await c.get('h', false, async (current) => {
        await Promise.resolve()
        return current()
      })
    ).toBe(true)
  })
})
