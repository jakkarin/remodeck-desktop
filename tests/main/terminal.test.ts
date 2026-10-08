import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTerminalSshArgs, randomPort } from '../../src/main/terminal/sshCommand'
import { IDLE_MS, TerminalService, type PtyLike } from '../../src/main/terminal/terminalService'

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

const NOTICE = '\r\n[remodeck] tunnel port busy, retrying…\r\n'
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
        { id: 'h1', sshHost: 'box1', label: 'Box One', protected: false },
        { id: 'h2', sshHost: 'box2', label: 'Box Two', protected: false }
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
      if (!connected(h)) throw new Error('Host is not connected')
    })
  }
  const targetFor = vi.fn((h: string) => ({
    exec: vi.fn(async () => ({
      code: 0,
      stdout: `/home/u/${h}.png
`,
      stderr: ''
    })),
    gitUrl: () => ''
  }))
  const svc = new TerminalService({
    sshPath: 'ssh',
    bridgePort: () => 4242,
    spawn,
    store: store as never,
    bridge: bridge as never,
    approval: approval as never,
    connection: connection as never,
    targetFor: targetFor as never
  })
  return { svc, targetFor, ptys, calls, spawn, bridge, approval, connection }
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
      `cd "$HOME"/'repos/api' && export GIT_CONFIG_COUNT=3 GIT_CONFIG_KEY_0='url.http://127.0.0.1:30000/s/tok/.insteadOf' GIT_CONFIG_VALUE_0='https://github.com/' GIT_CONFIG_KEY_1='url.http://127.0.0.1:30000/s/tok/.insteadOf' GIT_CONFIG_VALUE_1='git@github.com:' GIT_CONFIG_KEY_2='url.http://127.0.0.1:30000/s/tok/.insteadOf' GIT_CONFIG_VALUE_2='ssh://git@github.com/' && exec "$SHELL" -l`
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
    const { tabId, label, hostId } = await svc.open('w1')
    expect(label).toBe('Box One:api')
    expect(hostId).toBe('h1')
    expect(bridge.registerSession).toHaveBeenCalledOnce()
    const s = bridge.registerSession.mock.calls[0][0]
    expect(s).toMatchObject({ workspaceId: 'w1', tabLabel: label })
    expect(s.repo.id).toBe('r1')
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    ptys[0].dataCb('hello')
    expect(onData).toHaveBeenCalledWith(tabId, 'hello')
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
    expect(onData.mock.calls.map((c) => c[1])).toEqual([
      FORWARD_ERR,
      NOTICE,
      FORWARD_ERR,
      NOTICE,
      'welcome'
    ])
    expect(onData).toHaveBeenCalledWith(tabId, 'welcome')
    expect(onExit).not.toHaveBeenCalled()
    expect(new Set(calls.map(rportOf)).size).toBe(3)
    expect(bridge.registerSession).toHaveBeenCalledOnce()
    expect(bridge.revokeSession).not.toHaveBeenCalled()
  })

  it('gives up after 5 attempts, emits output then exit, and revokes', async () => {
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
    expect(events).toEqual([
      ...Array.from({ length: 4 }, () => ['data:' + FORWARD_ERR, 'data:' + NOTICE]).flat(),
      'data:' + FORWARD_ERR,
      'exit:255'
    ])
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
    await expect(svc.open('w1')).rejects.toThrow('is not connected')
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

  it('Disconnect (closeAllForHost) emits exit -1 for each of that host tabs only', async () => {
    const { svc, ptys, bridge, approval } = setup()
    const onExit = vi.fn()
    svc.on('exit', onExit)
    const a = await svc.open('w1')
    const b = await svc.open('w2')
    const c = await svc.open('w1')
    svc.closeAllForHost('h1')
    expect(onExit.mock.calls).toEqual([
      [a.tabId, -1],
      [c.tabId, -1]
    ])
    expect(onExit).not.toHaveBeenCalledWith(b.tabId, expect.anything())
    expect(bridge.revokeSession).toHaveBeenCalledTimes(2)
    expect(approval.revokeSession).toHaveBeenCalledTimes(2)
    // the killed ptys exiting afterwards must not emit a second exit
    ptys[0].exitCb({ exitCode: 0 })
    ptys[2].exitCb({ exitCode: 0 })
    expect(onExit).toHaveBeenCalledTimes(2)
  })

  it('closeAllForWorkspace closes only that workspace tabs and emits exit -1', async () => {
    const { svc, ptys, bridge, approval } = setup()
    const onExit = vi.fn()
    svc.on('exit', onExit)
    const a = await svc.open('w1')
    await svc.open('w2')
    const c = await svc.open('w1', '~/repos/api/sub')
    svc.closeAllForWorkspace('w1')
    expect(ptys.map((p) => p.killed)).toEqual([true, false, true])
    expect(onExit.mock.calls).toEqual([
      [a.tabId, -1],
      [c.tabId, -1]
    ])
    expect(bridge.revokeSession).toHaveBeenCalledTimes(2)
    expect(approval.revokeSession).toHaveBeenCalledTimes(2)
  })

  it('streams output immediately, before the retry window ends', async () => {
    const { svc, ptys } = setup()
    const onData = vi.fn()
    svc.on('data', onData)
    await svc.open('w1')
    ptys[0].dataCb('Enter passphrase: ')
    expect(onData).toHaveBeenCalledTimes(1)
  })

  it('releases tab and bridge session when the first spawn throws', async () => {
    const { svc, spawn, bridge, approval } = setup()
    spawn.mockImplementationOnce(() => {
      throw new Error('ENOENT ssh')
    })
    await expect(svc.open('w1')).rejects.toThrow('ENOENT ssh')
    const s = bridge.registerSession.mock.calls[0][0]
    expect(bridge.revokeSession).toHaveBeenCalledWith(s.token)
    expect(approval.revokeSession).toHaveBeenCalledWith(s.sessionId)
    svc.write('x', 'y')
  })

  it('emits error data and exit -1 and releases when a retry spawn throws', async () => {
    const { svc, ptys, spawn, bridge, approval } = setup()
    const events: string[] = []
    svc.on('data', (_t: string, d: string) => events.push('data:' + d))
    svc.on('exit', (_t: string, c: number) => events.push('exit:' + c))
    await svc.open('w1')
    spawn.mockImplementationOnce(() => {
      throw new Error('conpty boom')
    })
    ptys[0].dataCb(FORWARD_ERR)
    expect(() => ptys[0].exitCb({ exitCode: 255 })).not.toThrow()
    expect(events.slice(-2)).toEqual(['data:\r\n[remodeck] conpty boom\r\n', 'exit:-1'])
    expect(bridge.revokeSession).toHaveBeenCalledOnce()
    expect(approval.revokeSession).toHaveBeenCalledOnce()
  })

  describe('idle signal', () => {
    it('emits one idle with the workspaceId after IDLE_MS of silence', async () => {
      const { svc, ptys } = setup()
      const onIdle = vi.fn()
      svc.on('idle', onIdle)
      await svc.open('w1')
      ptys[0].dataCb('x')
      vi.advanceTimersByTime(IDLE_MS - 1)
      expect(onIdle).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(onIdle).toHaveBeenCalledOnce()
      expect(onIdle).toHaveBeenCalledWith('w1')
    })

    it('does not emit idle while data keeps arriving', async () => {
      const { svc, ptys } = setup()
      const onIdle = vi.fn()
      svc.on('idle', onIdle)
      await svc.open('w1')
      for (let i = 0; i < 5; i++) {
        ptys[0].dataCb('x')
        vi.advanceTimersByTime(1000)
      }
      expect(onIdle).not.toHaveBeenCalled()
      vi.advanceTimersByTime(IDLE_MS)
      expect(onIdle).toHaveBeenCalledOnce()
    })

    it('emits nothing more after idle until new data re-arms', async () => {
      const { svc, ptys } = setup()
      const onIdle = vi.fn()
      svc.on('idle', onIdle)
      await svc.open('w1')
      ptys[0].dataCb('x')
      vi.advanceTimersByTime(IDLE_MS * 3)
      expect(onIdle).toHaveBeenCalledOnce()
      ptys[0].dataCb('y')
      vi.advanceTimersByTime(IDLE_MS)
      expect(onIdle).toHaveBeenCalledTimes(2)
    })

    it('emits no idle when the tab is closed before IDLE_MS', async () => {
      const { svc, ptys } = setup()
      const onIdle = vi.fn()
      svc.on('idle', onIdle)
      const { tabId } = await svc.open('w1')
      ptys[0].dataCb('x')
      svc.close(tabId)
      vi.advanceTimersByTime(IDLE_MS * 2)
      expect(onIdle).not.toHaveBeenCalled()
    })
  })
})

describe('TerminalService.uploadImage', () => {
  it('throws for an unknown tab', async () => {
    const { svc, targetFor } = setup()
    await expect(svc.uploadImage('nope', new Uint8Array([1]), 'png')).rejects.toThrow()
    expect(targetFor).not.toHaveBeenCalled()
  })

  it("uploads through the tab's host target", async () => {
    const { svc, targetFor } = setup()
    const { tabId } = await svc.open('w2')
    await expect(svc.uploadImage(tabId, new Uint8Array([1]), 'png')).resolves.toBe('/home/u/h2.png')
    expect(targetFor).toHaveBeenCalledWith('h2')
  })

  it('rejects image upload for host tabs', async () => {
    const { svc, targetFor } = setup()
    const { tabId } = svc.openHost('h1', 'docker ps', 'logs')
    await expect(svc.uploadImage(tabId, new Uint8Array([1]), 'png')).rejects.toThrow(
      'Images can only be pasted into workspace terminals'
    )
    expect(targetFor).not.toHaveBeenCalled()
  })

  describe('host tabs', () => {
    beforeEach(() => vi.useFakeTimers())
    it('openHost spawns ssh -t <host> <cmd> without -R and registers no bridge session', () => {
      const { svc, calls, bridge } = setup()
      const r = svc.openHost('h1', 'docker ps', 'logs')
      expect(r).toEqual({ tabId: expect.any(String), label: 'logs', hostId: 'h1' })
      expect(calls[0]).toEqual(['-t', 'box1', 'docker ps'])
      expect(bridge.registerSession).not.toHaveBeenCalled()
    })

    it('host tab exit prints the exit line then emits exit', () => {
      const { svc, ptys, bridge } = setup()
      const events: string[] = []
      svc.on('data', (_id: string, d: string) => events.push(`data:${d}`))
      svc.on('exit', (id: string, c: number) => events.push(`exit:${id}:${c}`))
      const { tabId } = svc.openHost('h1', 'docker ps', 'logs')
      ptys[0].exitCb({ exitCode: 130 })
      expect(events).toEqual([
        'data:\r\n[remodeck] exited with code 130\r\n',
        `exit:${tabId}:130`
      ])
      expect(bridge.revokeSession).not.toHaveBeenCalled()
    })

    it('host tab output emits no idle', () => {
      const { svc, ptys } = setup()
      const idle = vi.fn()
      svc.on('idle', idle)
      svc.openHost('h1', 'docker ps', 'logs')
      ptys[0].dataCb('x')
      vi.advanceTimersByTime(IDLE_MS + 10)
      expect(idle).not.toHaveBeenCalled()
    })

    it('closeAllForHost closes host tabs too, emits exit -1', () => {
      const { svc, ptys } = setup()
      const exit = vi.fn()
      svc.on('exit', exit)
      const { tabId } = svc.openHost('h1', 'docker ps', 'logs')
      svc.closeAllForHost('h1')
      expect(ptys[0].killed).toBe(true)
      expect(exit).toHaveBeenCalledWith(tabId, -1)
    })

    it('closeAllForWorkspace leaves host tabs open', () => {
      const { svc, ptys } = setup()
      const exit = vi.fn()
      svc.on('exit', exit)
      svc.openHost('h1', 'docker ps', 'logs')
      svc.closeAllForWorkspace('w1')
      expect(ptys[0].killed).toBe(false)
      expect(exit).not.toHaveBeenCalled()
    })

    it('openHost throws on disconnected host', () => {
      const { svc, spawn } = setup(() => false)
      expect(() => svc.openHost('h1', 'docker ps', 'logs')).toThrow('Host is not connected')
      expect(spawn).not.toHaveBeenCalled()
    })

    it('openHost throws on unknown host', () => {
      const { svc } = setup()
      expect(() => svc.openHost('nope', 'docker ps', 'logs')).toThrow('Host not found')
    })

    it('spawn failure on openHost throws and leaves no tab', () => {
      const { svc, spawn } = setup()
      spawn.mockImplementationOnce(() => {
        throw new Error('boom')
      })
      expect(() => svc.openHost('h1', 'docker ps', 'logs')).toThrow('boom')
      expect(() => svc.write('x', 'y')).not.toThrow()
      const exit = vi.fn()
      svc.on('exit', exit)
      svc.closeAllForHost('h1')
      expect(exit).not.toHaveBeenCalled()
    })
  })
})
