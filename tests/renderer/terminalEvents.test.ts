import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/renderer/src/api', () => ({
  api: { terminal: { open: vi.fn() }, containers: { openTerminal: vi.fn() } }
}))

import { api } from '../../src/renderer/src/api'
import { onTerminalOpened, openHostTerminal } from '../../src/renderer/src/terminalEvents'
import type { HostTerminalRequest } from '../../src/shared/containers'

const req = { kind: 'shell', containerId: 'c1' } as unknown as HostTerminalRequest

describe('openHostTerminal', () => {
  it('announces the opened tab', async () => {
    const tab = { tabId: 't1', label: 'x', hostId: 'h1' }
    vi.mocked(api.containers.openTerminal).mockResolvedValue(tab)
    const seen: unknown[] = []
    const off = onTerminalOpened((t) => seen.push(t))
    const res = await openHostTerminal('h1', req)
    off()
    expect(api.containers.openTerminal).toHaveBeenCalledWith('h1', req)
    expect(res).toEqual(tab)
    expect(seen).toEqual([tab])
  })

  it('does not announce on rejection', async () => {
    vi.mocked(api.containers.openTerminal).mockRejectedValue(new Error('boom'))
    const seen: unknown[] = []
    const off = onTerminalOpened((t) => seen.push(t))
    await expect(openHostTerminal('h1', req)).rejects.toThrow('boom')
    off()
    expect(seen).toEqual([])
  })
})
