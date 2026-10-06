import { describe, expect, it, vi } from 'vitest'
import { parsePreflight, PREFLIGHT_SCRIPT } from '../../src/main/sandbox/preflight'
import { ConnectionService } from '../../src/main/connection/connectionService'
import type { SandboxTarget } from '../../src/main/sandbox/target'
import type { ProcResult } from '../../src/main/proc/run'
import type { HostStatus } from '../../src/shared/types'
import { LocalTarget } from '../../src/main/sandbox/target'

const ok = (stdout: string): ProcResult => ({ code: 0, stdout, stderr: '' })

type Answers = {
  connect?: ProcResult | Error
  preflight?: ProcResult | (() => Promise<ProcResult>)
}

function make(answers: Answers, forward = true) {
  const calls = { connect: 0, preflight: 0 }
  const target: SandboxTarget = {
    exec: async (script: string) => {
      if (script === PREFLIGHT_SCRIPT) {
        calls.preflight++
        const p = answers.preflight ?? ok('')
        return typeof p === 'function' ? p() : p
      }
      calls.connect++
      const r = answers.connect ?? ok('')
      if (r instanceof Error) throw r
      return r
    },
    gitUrl: (p) => p
  }
  const onDisconnect = vi.fn()
  const checkForward = vi.fn(async () => forward)
  const svc = new ConnectionService({
    targetFor: () => target,
    sshHostFor: () => 'ai-box',
    checkForward,
    onDisconnect
  })
  const events: HostStatus[] = []
  svc.on('status', (_id: string, s: HostStatus) => events.push(s))
  return { svc, events, onDisconnect, calls, checkForward }
}

describe('parsePreflight', () => {
  it('parses version and remotehttp', () => {
    expect(parsePreflight('git=git version 2.43.0\nremotehttp=1\n')).toEqual({
      gitVersion: 'git version 2.43.0',
      remoteHttp: true
    })
  })
  it('treats empty git as null', () => {
    expect(parsePreflight('git=\nremotehttp=0\n')).toEqual({ gitVersion: null, remoteHttp: false })
  })
})

describe('PREFLIGHT_SCRIPT on local bash', () => {
  it('prints exactly two lines', async () => {
    const r = await new LocalTarget(process.cwd()).exec(PREFLIGHT_SCRIPT)
    const lines = r.stdout.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^git=/)
    expect(lines[1]).toMatch(/^remotehttp=[01]$/)
  })
})

const GIT = 'git=git version 2.43.0\nremotehttp=1\n'

describe('ConnectionService', () => {
  it('starts disconnected', () => {
    expect(make({}).svc.status('h')).toEqual({ state: 'disconnected' })
  })

  it('connects and emits connecting then connected', async () => {
    const { svc, events } = make({ connect: ok('') })
    expect(await svc.connect('h')).toEqual({ state: 'connected' })
    expect(events.map((e) => e.state)).toEqual(['connecting', 'connected'])
    expect(() => svc.requireConnected('h')).not.toThrow()
  })

  it('connects a host that has no git', async () => {
    const { svc } = make({ connect: ok(''), preflight: ok('git=\nremotehttp=0\n') })
    expect(await svc.connect('h')).toEqual({ state: 'connected' })
  })

  it('reports ssh failure as before', async () => {
    const { svc } = make({ connect: { code: 255, stdout: '', stderr: 'no route' } })
    const s = await svc.connect('h')
    expect(s.state).toBe('error')
    expect(s.error).toBe('no route\nลองรัน ssh ai-box ใน terminal ของระบบก่อน')
  })

  it('treats other non-zero exits as ssh failure', async () => {
    const { svc } = make({ connect: { code: 1, stdout: '', stderr: '' } })
    const s = await svc.connect('h')
    expect(s.error).toBe('ssh exit 1\nลองรัน ssh ai-box ใน terminal ของระบบก่อน')
  })

  it('treats exec rejection as ssh failure', async () => {
    const { svc } = make({ connect: new Error('spawn ssh ENOENT') })
    const s = await svc.connect('h')
    expect(s.state).toBe('error')
    expect(s.error).toContain('spawn ssh ENOENT')
    expect(s.error).toContain('ลองรัน ssh ai-box ใน terminal ของระบบก่อน')
  })

  it('255 with empty stderr reports ssh exit 255', async () => {
    const { svc } = make({ connect: { code: 255, stdout: '', stderr: '' } })
    const s = await svc.connect('h1')
    expect(s.error).toBe('ssh exit 255\nลองรัน ssh ai-box ใน terminal ของระบบก่อน')
  })

  it('returns the in-flight promise while connecting', async () => {
    const { svc } = make({})
    const a = svc.connect('h')
    const b = svc.connect('h')
    expect(b).toBe(a)
    await a
  })

  it('disconnect resets state and calls onDisconnect', async () => {
    const { svc, onDisconnect } = make({})
    await svc.connect('h')
    svc.disconnect('h')
    expect(svc.status('h')).toEqual({ state: 'disconnected' })
    expect(onDisconnect).toHaveBeenCalledWith('h')
  })

  it('requireConnected throws when not connected', () => {
    expect(() => make({}).svc.requireConnected('h')).toThrow('Host ยังไม่ได้ connect')
  })

  it('disconnect during in-flight connect is not overwritten', async () => {
    let release!: (r: ProcResult) => void
    const target: SandboxTarget = {
      exec: () => new Promise<ProcResult>((res) => (release = res)),
      gitUrl: (p) => p
    }
    const svc = new ConnectionService({
      targetFor: () => target,
      sshHostFor: () => 'ai-box',
      checkForward: async () => true,
      onDisconnect: vi.fn()
    })
    const p = svc.connect('h1')
    svc.disconnect('h1')
    release(ok(''))
    const s = await p
    expect(s.state).toBe('disconnected')
    expect(svc.status('h1').state).toBe('disconnected')
  })

  describe('probeGit', () => {
    it('returns null without git and skips the forward check', async () => {
      const { svc, checkForward } = make({ connect: ok(''), preflight: ok('git=\nremotehttp=0\n') })
      await svc.connect('h')
      expect(await svc.probeGit('h')).toBeNull()
      expect(checkForward).not.toHaveBeenCalled()
    })

    it('returns the capability and caches it until force', async () => {
      const { svc, calls } = make({ connect: ok(''), preflight: ok(GIT) }, false)
      await svc.connect('h')
      expect(await svc.probeGit('h')).toEqual({
        version: 'git version 2.43.0',
        remoteHttp: true,
        forward: false
      })
      await svc.probeGit('h')
      expect(calls.preflight).toBe(1)
      await svc.probeGit('h', true)
      expect(calls.preflight).toBe(2)
    })

    it('caches a null result too', async () => {
      const { svc, calls } = make({ connect: ok(''), preflight: ok('git=\nremotehttp=0\n') })
      await svc.connect('h')
      await svc.probeGit('h')
      await svc.probeGit('h')
      expect(calls.preflight).toBe(1)
    })

    it('dedupes concurrent probes', async () => {
      const { svc, calls } = make({ connect: ok(''), preflight: ok(GIT) })
      await svc.connect('h')
      const [a, b] = await Promise.all([svc.probeGit('h'), svc.probeGit('h')])
      expect(a).toEqual(b)
      expect(calls.preflight).toBe(1)
    })

    it('drops a probe result that lands after disconnect', async () => {
      let release!: (r: ProcResult) => void
      let first = true
      const { svc, calls } = make({
        connect: ok(''),
        preflight: () => {
          if (first) {
            first = false
            return new Promise<ProcResult>((res) => (release = res))
          }
          return Promise.resolve(ok('git=\nremotehttp=0\n'))
        }
      })
      await svc.connect('h')
      const stale = svc.probeGit('h')
      svc.disconnect('h')
      await svc.connect('h')
      release(ok(GIT))
      await stale
      expect(await svc.probeGit('h')).toBeNull()
      expect(calls.preflight).toBe(2)
    })

    it('does not cache a failed preflight as no-git', async () => {
      let bad = true
      const { svc } = make({
        connect: ok(''),
        preflight: () =>
          Promise.resolve(bad ? { code: 255, stdout: '', stderr: 'broken pipe' } : ok(GIT))
      })
      await svc.connect('h')
      await expect(svc.probeGit('h')).rejects.toThrow('broken pipe')
      bad = false
      expect(await svc.probeGit('h')).toEqual({
        version: 'git version 2.43.0',
        remoteHttp: true,
        forward: true
      })
    })

    it('a forced probe wins over an older in-flight probe', async () => {
      const releases: ((r: ProcResult) => void)[] = []
      const { svc } = make({
        connect: ok(''),
        preflight: () => new Promise<ProcResult>((res) => releases.push(res))
      })
      await svc.connect('h')
      const a = svc.probeGit('h')
      const b = svc.probeGit('h', true)
      releases[1](ok(GIT))
      await b
      releases[0](ok('git=\nremotehttp=0\n'))
      await a
      expect((await svc.probeGit('h'))?.version).toBe('git version 2.43.0')
    })

    it('clears the cache on disconnect', async () => {
      const { svc, calls } = make({ connect: ok(''), preflight: ok(GIT) })
      await svc.connect('h')
      await svc.probeGit('h')
      svc.disconnect('h')
      await svc.connect('h')
      await svc.probeGit('h')
      expect(calls.preflight).toBe(2)
    })

    it('throws on a disconnected host', async () => {
      await expect(make({}).svc.probeGit('h')).rejects.toThrow('Host ยังไม่ได้ connect')
    })
  })
})
