import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { AutoSync, FULL_MS, LIGHT_MS } from '../../../src/main/sync/autoSync'

const NOT_CONNECTED = 'Host ยังไม่ได้ connect'

interface Made {
  deps: {
    light: Mock<(id: string) => Promise<unknown>>
    full: Mock<(id: string) => Promise<{ rewritten: string[] }>>
    canSync: Mock<(id: string) => boolean>
    onSynced: Mock<(id: string, info: unknown) => void>
    now: () => number
  }
  sync: AutoSync
}

function make(opts: { canSync?: (id: string) => boolean } = {}): Made {
  const deps: Made['deps'] = {
    light: vi.fn(async (): Promise<unknown> => undefined),
    full: vi.fn(async (): Promise<{ rewritten: string[] }> => ({ rewritten: [] })),
    canSync: vi.fn(opts.canSync ?? ((): boolean => true)),
    onSynced: vi.fn(),
    now: () => 1234
  }
  const sync = new AutoSync(deps as ConstructorParameters<typeof AutoSync>[0])
  return { deps, sync }
}

describe('AutoSync', () => {
  let current: AutoSync | null = null
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    current?.stop()
    current = null
    vi.useRealTimers()
  })

  it('runs light every 30s and full every 5min for the active workspace', async () => {
    const { deps, sync } = make()
    current = sync
    sync.setActive('w1')
    await vi.advanceTimersByTimeAsync(LIGHT_MS)
    expect(deps.light).toHaveBeenCalledTimes(1)
    expect(deps.light).toHaveBeenCalledWith('w1')
    expect(deps.full).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(FULL_MS - LIGHT_MS)
    expect(deps.full).toHaveBeenCalledWith('w1')
  })

  it('idle runs light for the active workspace only', async () => {
    const { deps, sync } = make()
    current = sync
    sync.setActive('w1')
    sync.idle('w2')
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.light).not.toHaveBeenCalled()
    sync.idle('w1')
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.light).toHaveBeenCalledWith('w1')
  })

  it('drops a light request while another run is pending', async () => {
    const { deps, sync } = make()
    current = sync
    deps.light.mockImplementation(() => new Promise(() => {}))
    sync.setActive('w1')
    sync.idle('w1')
    sync.idle('w1')
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.light).toHaveBeenCalledTimes(1)
  })

  it('queues a full request during a light run and runs it once', async () => {
    const { deps, sync } = make()
    current = sync
    let release: () => void = () => {}
    deps.light.mockImplementation(
      () =>
        new Promise<void>((r) => {
          release = r
        })
    )
    sync.setActive('w1')
    sync.idle('w1')
    await vi.advanceTimersByTimeAsync(0)
    const a = sync.syncNow('w1')
    const b = sync.syncNow('w1')
    await vi.advanceTimersByTimeAsync(0)
    expect(deps.full).not.toHaveBeenCalled()
    release()
    await Promise.all([a, b])
    expect(deps.full).toHaveBeenCalledTimes(1)
  })

  it('syncNow resets the full timer', async () => {
    const { deps, sync } = make()
    current = sync
    sync.setActive('w1')
    await vi.advanceTimersByTimeAsync(200_000)
    await sync.syncNow('w1')
    expect(deps.full).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(FULL_MS - 1000)
    expect(deps.full).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(deps.full).toHaveBeenCalledTimes(2)
  })

  it('does nothing on ticks when canSync is false; syncNow rejects and reports', async () => {
    const { deps, sync } = make({ canSync: () => false })
    current = sync
    sync.setActive('w1')
    await vi.advanceTimersByTimeAsync(FULL_MS)
    expect(deps.light).not.toHaveBeenCalled()
    expect(deps.full).not.toHaveBeenCalled()
    await expect(sync.syncNow('w1')).rejects.toThrow(NOT_CONNECTED)
    expect(deps.onSynced).toHaveBeenCalledWith('w1', {
      kind: 'full',
      at: 1234,
      error: NOT_CONNECTED
    })
  })

  it('unknown workspace is a no-op', async () => {
    const { deps, sync } = make({ canSync: (id) => id !== 'gone' })
    current = sync
    sync.setActive('gone')
    expect(() => sync.idle('gone')).not.toThrow()
    await vi.advanceTimersByTimeAsync(FULL_MS)
    expect(deps.light).not.toHaveBeenCalled()
    expect(deps.full).not.toHaveBeenCalled()
  })

  it('error reports and next tick still runs', async () => {
    const { deps, sync } = make()
    current = sync
    deps.light.mockRejectedValueOnce(new Error('boom'))
    sync.setActive('w1')
    await vi.advanceTimersByTimeAsync(LIGHT_MS)
    expect(deps.onSynced).toHaveBeenCalledWith('w1', { kind: 'light', at: 1234, error: 'boom' })
    await vi.advanceTimersByTimeAsync(LIGHT_MS)
    expect(deps.light).toHaveBeenCalledTimes(2)
  })

  it('setActive(null) and stop() end all calls', async () => {
    const { deps, sync } = make()
    current = sync
    sync.setActive('w1')
    sync.setActive(null)
    sync.idle('w1')
    await vi.advanceTimersByTimeAsync(FULL_MS)
    expect(deps.light).not.toHaveBeenCalled()
    sync.setActive('w1')
    sync.stop()
    await vi.advanceTimersByTimeAsync(FULL_MS)
    expect(deps.light).not.toHaveBeenCalled()
    expect(deps.full).not.toHaveBeenCalled()
  })

  it('syncNow reports success and rejects with the error on failure', async () => {
    const { deps, sync } = make()
    current = sync
    await expect(sync.syncNow('w1')).resolves.toEqual({ rewritten: [] })
    expect(deps.onSynced).toHaveBeenCalledWith('w1', { kind: 'full', at: 1234 })
    deps.full.mockRejectedValueOnce(new Error('bad'))
    await expect(sync.syncNow('w1')).rejects.toThrow('bad')
    expect(deps.onSynced).toHaveBeenCalledWith('w1', { kind: 'full', at: 1234, error: 'bad' })
  })
})
