import { describe, expect, it, vi } from 'vitest'
import { containersApi } from '../../src/main/app'
import type { DockerCapability, Host } from '../../src/shared/types'
import type { ContainerAction } from '../../src/shared/containers'

vi.mock('electron', () => ({ Notification: class {}, clipboard: {}, shell: {} }))

const host = { id: 'h1', sshHost: 'box', label: 'box' } as Host

function setup(opts: { connected?: boolean; probe?: DockerCapability } = {}) {
  const connected = opts.connected ?? true
  const connection = {
    requireConnected: vi.fn(() => {
      if (!connected) throw new Error('Host ยังไม่ได้ connect')
    }),
    probeDocker: vi.fn(
      async (): Promise<DockerCapability> =>
        opts.probe ?? { state: 'ok', version: '27', apiVersion: '1.47' }
    )
  }
  const service = { open: vi.fn(async () => []), action: vi.fn(async () => undefined) }
  const hostOf = vi.fn((id: string) => {
    if (id !== 'h1') throw new Error('ไม่พบ host')
    return host
  })
  return { connection, service, hostOf, api: containersApi({ hostOf, connection, service }) }
}

describe('containersApi', () => {
  it('open on a disconnected host throws and never touches the service', async () => {
    const t = setup({ connected: false })
    await expect(t.api.open('h1')).rejects.toThrow('Host ยังไม่ได้ connect')
    expect(t.service.open).not.toHaveBeenCalled()
  })

  it('open rejects an unknown host', async () => {
    const t = setup()
    await expect(t.api.open('nope')).rejects.toThrow('ไม่พบ host')
  })

  it('open throws the probe detail when docker is not ok', async () => {
    const t = setup({ probe: { state: 'no-permission', detail: 'permission denied' } })
    await expect(t.api.open('h1')).rejects.toThrow('permission denied')
    expect(t.service.open).not.toHaveBeenCalled()
  })

  it('open delegates when docker is ok', async () => {
    const t = setup()
    await expect(t.api.open('h1')).resolves.toEqual([])
    expect(t.service.open).toHaveBeenCalledWith('h1')
  })

  it('action rejects anything but the four actions', async () => {
    const t = setup()
    await expect(t.api.action('h1', 'abc123abc123', 'kill' as ContainerAction)).rejects.toThrow()
    expect(t.service.action).not.toHaveBeenCalled()
  })

  it('action requires a connected host', async () => {
    const t = setup({ connected: false })
    await expect(t.api.action('h1', 'abc123abc123', 'stop')).rejects.toThrow(
      'Host ยังไม่ได้ connect'
    )
    expect(t.service.action).not.toHaveBeenCalled()
  })

  it('action delegates a valid action', async () => {
    const t = setup()
    await t.api.action('h1', 'abc123abc123', 'restart')
    expect(t.service.action).toHaveBeenCalledWith('h1', 'abc123abc123', 'restart')
  })
})
