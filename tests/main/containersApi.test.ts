import { describe, expect, it, vi } from 'vitest'
import { containersApi, wireContainerService } from '../../src/main/app'
import type { DockerCapability, Host } from '../../src/shared/types'
import type { ContainerAction } from '../../src/shared/containers'

vi.mock('electron', () => ({ Notification: class {}, clipboard: {}, shell: {} }))

const ID = 'a'.repeat(64)
const host = { id: 'h1', sshHost: 'box', label: 'box' } as Host

function setup(opts: { connected?: boolean; probe?: DockerCapability; onProbe?: () => void } = {}) {
  let connected = opts.connected ?? true
  const connection = {
    requireConnected: vi.fn(() => {
      if (!connected) throw new Error('Host ยังไม่ได้ connect')
    }),
    probeDocker: vi.fn(async (): Promise<DockerCapability> => {
      opts.onProbe?.()
      return opts.probe ?? { state: 'ok', version: '27', apiVersion: '1.47' }
    })
  }
  const service = {
    open: vi.fn(async () => ({ list: [], live: true })),
    action: vi.fn(async () => undefined),
    find: vi.fn((_h: string, id: string) =>
      id === ID ? ({ id: ID, name: 'web-1' } as never) : null
    ),
    project: vi.fn((_h: string, name: string) =>
      name === 'shop'
        ? ({
            name: 'shop',
            workingDir: '/srv/shop',
            configFiles: ['/srv/shop/compose.yml']
          } as never)
        : null
    )
  }
  const terminal = {
    openHost: vi.fn((hostId: string, _cmd: string, label: string) => ({
      tabId: 't1',
      label,
      hostId
    }))
  }
  const hostOf = vi.fn((id: string) => {
    if (id !== 'h1') throw new Error('ไม่พบ host')
    return host
  })
  return {
    connection,
    service,
    hostOf,
    disconnect: () => (connected = false),
    terminal,
    api: containersApi({ hostOf, connection, service, terminal })
  }
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
    await expect(t.api.open('h1')).resolves.toEqual({ list: [], live: true })
    expect(t.service.open).toHaveBeenCalledWith('h1')
  })

  it('open rejects without opening the service when the host disconnects during the probe', async () => {
    const ref: { disconnect?: () => void } = {}
    const t = setup({ onProbe: () => ref.disconnect?.() })
    ref.disconnect = t.disconnect
    await expect(t.api.open('h1')).rejects.toThrow('Host ยังไม่ได้ connect')
    expect(t.service.open).not.toHaveBeenCalled()
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

describe('wireContainerService', () => {
  it('forwards changed/live as IPC sends and disposes the host on disconnect', async () => {
    const { EventEmitter } = await import('node:events')
    const svc = Object.assign(new EventEmitter(), { dispose: vi.fn() })
    const send = vi.fn()
    const wiring = wireContainerService(svc as never, send)
    svc.emit('changed', 'h1', [{ id: 'x' }])
    svc.emit('live', 'h1', false)
    expect(send).toHaveBeenNthCalledWith(1, 'event:containers-changed', 'h1', [{ id: 'x' }])
    expect(send).toHaveBeenNthCalledWith(2, 'event:containers-live', 'h1', false)
    wiring.onDisconnect('h1')
    expect(svc.dispose).toHaveBeenCalledWith('h1')
  })
})

describe('containersApi.openTerminal', () => {
  it('logs resolves the container name and opens a host tab', async () => {
    const t = setup()
    const r = await t.api.openTerminal('h1', { kind: 'logs', id: ID })
    expect(t.terminal.openHost).toHaveBeenCalledWith(
      'h1',
      `docker logs -f --tail 500 '${ID}'`,
      'logs · web-1'
    )
    expect(r).toEqual({ tabId: 't1', label: 'logs · web-1', hostId: 'h1' })
  })

  it('shell label is "sh · <name>"', async () => {
    const t = setup()
    await t.api.openTerminal('h1', { kind: 'shell', id: ID })
    expect(t.terminal.openHost.mock.calls[0][2]).toBe('sh · web-1')
  })

  it('compose uses the service project dir and files, label "up · shop"', async () => {
    const t = setup()
    await t.api.openTerminal('h1', { kind: 'compose', project: 'shop', action: 'up' })
    const [, cmd, label] = t.terminal.openHost.mock.calls[0]
    expect(label).toBe('up · shop')
    expect(cmd).toContain('/srv/shop')
    expect(cmd).toContain('compose.yml')
  })

  it('rejects when the container is not in the list', async () => {
    const t = setup()
    await expect(t.api.openTerminal('h1', { kind: 'logs', id: 'c'.repeat(64) })).rejects.toThrow(
      'ไม่พบ container นี้'
    )
    expect(t.terminal.openHost).not.toHaveBeenCalled()
  })

  it('rejects an unknown compose project', async () => {
    const t = setup()
    await expect(
      t.api.openTerminal('h1', { kind: 'compose', project: 'nope', action: 'up' })
    ).rejects.toThrow('ไม่พบ compose project นี้')
  })

  it('rejects malformed requests', async () => {
    const t = setup()
    for (const bad of [null, { kind: 'exec' }, { kind: 'compose', project: 'shop', action: 'rm' }])
      await expect(t.api.openTerminal('h1', bad as never)).rejects.toThrow(
        'Invalid terminal request'
      )
    expect(t.terminal.openHost).not.toHaveBeenCalled()
  })

  it('requires a connected host', async () => {
    const t = setup({ connected: false })
    await expect(t.api.openTerminal('h1', { kind: 'logs', id: ID })).rejects.toThrow(
      'Host ยังไม่ได้ connect'
    )
    expect(t.terminal.openHost).not.toHaveBeenCalled()
  })
})
