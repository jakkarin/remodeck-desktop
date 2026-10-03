import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTerminalSshArgs, randomPort } from '../../src/main/terminal/sshCommand'
import { TerminalService, type PtyLike } from '../../src/main/terminal/terminalService'

class FakePty implements PtyLike {
  dataCb: (d: string) => void = () => {}
  exitCb: (e: { exitCode: number }) => void = () => {}
  written: string[] = []
  killed = false
  resized: Array<[number, number]> = []
  onData(cb: (d: string) => void): void {
    this.dataCb = cb
  }
  onExit(cb: (e: { exitCode: number }) => void): void {
    this.exitCb = cb
  }
  write(d: string): void {
    this.written.push(d)
  }
  resize(c: number, r: number): void {
    this.resized.push([c, r])
  }
  kill(): void {
    this.killed = true
  }
}

const FORWARD_ERR = 'Warning: remote port forwarding failed for listen port 30000\r\n'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(connected: (h: string) => boolean = () => true) {
  const ptys: FakePty[] = []
  const calls: string[][] = []
  const spawn = vi.fn((_file: string, args: string[]) => {
    calls.push(args)
    const p = new FakePty()
    ptys.push(p)
    return p
  })
  const store = {
    config: {
      hosts: [
        { id: 'h1', sshHost: 'box1', label: 'Box One' },
        { id: 'h2', sshHost: 'box2', label: 'Box Two' }
      ],
      repos: [
        {
          id: 'r1',
          owner: 'o',
          name: 'api',
          defaultBranch: 'main',
          protectedBranches: [],
          alwaysAllowPush: false,
          enforceRules: true
        }
      ],
      workspaces: [
        { id: 'w1', repoId: 'r1', hostId: 'h1', sandboxPath: '~/repos/api' },
        { id: 'w2', repoId: 'r1', hostId: 'h2', sandboxPath: '/srv/x/api' }
      ]
    }
  }
  const bridge = { registerSession: vi.fn(), revokeSession: vi.fn() }
  const approval = { revokeSession: vi.fn() }
  const connection = {
    requireConnected: vi.fn((h: string) => {
      if (!connected(h)) throw new Error('Host ยังไม่ได้ connect')
    })
  }
  const svc = new TerminalService({
    sshPath: 'ssh',
    bridgePort: () => 4242,
    spawn,
    store: store as never,
    bridge: bridge as never,
    approval: approval as never,
    connection: connection as never
  })
  return { svc, ptys, calls, spawn, bridge, approval, connection }
}

const rportOf = (args: string[]): string => args[args.indexOf('-R') + 1].split(':')[1]

describe('buildTerminalSshArgs', () => {
  it('builds exact ssh args', () => {
    expect(
      buildTerminalSshArgs({
        sshHost: 'box1',
        rport: 30000,
        bridgePort: 4242,
        token: 'tok',
        path: '~/repos/api'
      })
    ).toEqual([
      '-t',
      '-o',
      'ExitOnForwardFailure=yes',
      '-R',
      '127.0.0.1:30000:127.0.0.1:4242',
      'box1',
      `cd "$HOME"/'repos/api' && export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0='url.http://127.0.0.1:30000/s/tok/.insteadOf' GIT_CONFIG_VALUE_0='https://github.com/' && exec "$SHELL" -l`
    ])
  })
})

describe('randomPort', () => {
  it('stays in [20000, 60000)', () => {
    expect(randomPort(() => 0)).toBe(20000)
    expect(randomPort(() => 0.99999)).toBe(59999)
  })
})

describe('TerminalService', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('opens a tab, registers the bridge session and streams data', async () => {
    const { svc, ptys, bridge } = setup()
    const onData = vi.fn()
    svc.on('data', onData)
    const { tabId, label } = await svc.open('w1')
    expect(label).toBe('Box One:api')
    expect(bridge.registerSession).toHaveBeenCalledOnce()
    const s = bridge.registerSession.mock.calls[0][0]
    expect(s).toMatchObject({ workspaceId: 'w1', tabLabel: label })
    expect(s.repo.id).toBe('r1')
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    ptys[0].dataCb('hello')
    vi.advanceTimersByTime(3000)
    expect(onData).toHaveBeenCalledWith(tabId, 'hello')
    ptys[0].dataCb('more')
    expect(onData).toHaveBeenLastCalledWith(tabId, 'more')
  })

  it('retries on remote port forwarding failure with different ports', async () => {
    const { svc, ptys, calls, spawn, bridge } = setup()
    const onData = vi.fn()
    const onExit = vi.fn()
    svc.on('data', onData)
    svc.on('exit', onExit)
    const { tabId } = await svc.open('w1')
    ptys[0].dataCb(FORWARD_ERR)
    ptys[0].exitCb({ exitCode: 255 })
    expect(spawn).toHaveBeenCalledTimes(2)
    ptys[1].dataCb(FORWARD_ERR)
    ptys[1].exitCb({ exitCode: 255 })
    expect(spawn).toHaveBeenCalledTimes(3)
    ptys[2].dataCb('welcome')
    vi.advanceTimersByTime(3000)
    expect(onData).toHaveBeenCalledTimes(1)
    expect(onData).toHaveBeenCalledWith(tabId, 'welcome')
    expect(onExit).not.toHaveBeenCalled()
    expect(new Set(calls.map(rportOf)).size).toBe(3)
    expect(bridge.registerSession).toHaveBeenCalledOnce()
    expect(bridge.revokeSession).not.toHaveBeenCalled()
  })

  it('gives up after 5 attempts, emits buffered output then exit, and revokes', async () => {
    const { svc, ptys, spawn, bridge, approval } = setup()
    const events: string[] = []
    svc.on('data', (_t: string, d: string) => events.push('data:' + d))
    svc.on('exit', (_t: string, c: number) => events.push('exit:' + c))
    await svc.open('w1')
    for (let i = 0; i < 5; i++) {
      ptys[i].dataCb(FORWARD_ERR)
      ptys[i].exitCb({ exitCode: 255 })
    }
    expect(spawn).toHaveBeenCalledTimes(5)
    expect(events).toEqual(['data:' + FORWARD_ERR, 'exit:255'])
    expect(bridge.revokeSession).toHaveBeenCalledOnce()
    expect(approval.revokeSession).toHaveBeenCalledOnce()
  })

  it('does not retry when the failure happens after 3s or without the marker', async () => {
    const { svc, ptys, spawn } = setup()
    const onExit = vi.fn()
    svc.on('exit', onExit)
    await svc.open('w1')
    vi.advanceTimersByTime(3500)
    ptys[0].dataCb(FORWARD_ERR)
    ptys[0].exitCb({ exitCode: 255 })
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(onExit).toHaveBeenCalledTimes(1)
    await svc.open('w1')
    ptys[1].dataCb('Permission denied')
    ptys[1].exitCb({ exitCode: 255 })
    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('close kills the pty and revokes bridge and approval sessions', async () => {
    const { svc, ptys, bridge, approval } = setup()
    const onExit = vi.fn()
    svc.on('exit', onExit)
    const { tabId } = await svc.open('w1')
    const s = bridge.registerSession.mock.calls[0][0]
    svc.close(tabId)
    expect(ptys[0].killed).toBe(true)
    expect(bridge.revokeSession).toHaveBeenCalledWith(s.token)
    expect(approval.revokeSession).toHaveBeenCalledWith(s.sessionId)
    ptys[0].exitCb({ exitCode: 0 })
    expect(bridge.revokeSession).toHaveBeenCalledTimes(1)
    expect(onExit).not.toHaveBeenCalled()
  })

  it('write/resize hit the pty; unknown tabs are no-ops', async () => {
    const { svc, ptys } = setup()
    const { tabId } = await svc.open('w1')
    svc.write(tabId, 'ls\r')
    svc.resize(tabId, 100, 30)
    expect(ptys[0].written).toEqual(['ls\r'])
    expect(ptys[0].resized).toEqual([[100, 30]])
    expect(() => {
      svc.write('nope', 'x')
      svc.resize('nope', 1, 1)
      svc.close('nope')
    }).not.toThrow()
  })

  it('exit by itself emits exit and revokes', async () => {
    const { svc, ptys, bridge } = setup()
    const onExit = vi.fn()
    svc.on('exit', onExit)
    const { tabId } = await svc.open('w1')
    vi.advanceTimersByTime(4000)
    ptys[0].exitCb({ exitCode: 0 })
    expect(onExit).toHaveBeenCalledWith(tabId, 0)
    expect(bridge.revokeSession).toHaveBeenCalledOnce()
  })

  it('throws on disconnected host or unknown workspace', async () => {
    const { svc, connection, spawn, bridge } = setup((h) => h !== 'h1')
    await expect(svc.open('w1')).rejects.toThrow('ยังไม่ได้ connect')
    expect(connection.requireConnected).toHaveBeenCalledWith('h1')
    await expect(svc.open('zzz')).rejects.toThrow()
    expect(spawn).not.toHaveBeenCalled()
    expect(bridge.registerSession).not.toHaveBeenCalled()
  })

  it('uses a custom path and basename in the label', async () => {
    const { svc, calls } = setup()
    const { label } = await svc.open('w2', '/srv/x/api/sub')
    expect(label).toBe('Box Two:sub')
    expect(calls[0][calls[0].length - 1]).toContain("'/srv/x/api/sub'")
  })

  it('closeAllForHost kills only that host tabs', async () => {
    const { svc, ptys } = setup()
    await svc.open('w1')
    await svc.open('w2')
    await svc.open('w1')
    svc.closeAllForHost('h1')
    expect(ptys.map((p) => p.killed)).toEqual([true, false, true])
  })
})
