import { describe, expect, it, vi } from 'vitest'
import { parsePreflight, PREFLIGHT_SCRIPT } from '../../src/main/sandbox/preflight'
import { ConnectionService } from '../../src/main/connection/connectionService'
import type { SandboxTarget } from '../../src/main/sandbox/target'
import type { ProcResult } from '../../src/main/proc/run'
import type { HostStatus } from '../../src/shared/types'
import { LocalTarget } from '../../src/main/sandbox/target'

const ok = (stdout: string): ProcResult => ({ code: 0, stdout, stderr: '' })

function fakeTarget(r: ProcResult | Error): SandboxTarget {
  return {
    exec: async () => {
      if (r instanceof Error) throw r
      return r
    },
    gitUrl: (p) => p
  }
}

function make(r: ProcResult | Error, forward = true) {
  const onDisconnect = vi.fn()
  const svc = new ConnectionService({
    targetFor: () => fakeTarget(r),
    sshHostFor: () => 'ai-box',
    checkForward: async () => forward,
    onDisconnect
  })
  const events: HostStatus[] = []
  svc.on('status', (_id: string, s: HostStatus) => events.push(s))
  return { svc, events, onDisconnect }
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

describe('ConnectionService', () => {
  it('starts disconnected', () => {
    expect(make(ok('')).svc.status('h')).toEqual({ state: 'disconnected', warnings: [] })
  })

  it('connects when git present and emits connecting then connected', async () => {
    const { svc, events } = make(ok('git=git version 2.43.0\nremotehttp=1\n'))
    const s = await svc.connect('h')
    expect(s).toEqual({ state: 'connected', gitVersion: 'git version 2.43.0', warnings: [] })
    expect(events.map((e) => e.state)).toEqual(['connecting', 'connected'])
    expect(() => svc.requireConnected('h')).not.toThrow()
  })

  it('errors when git is missing', async () => {
    const { svc } = make(ok('git=\nremotehttp=0\n'))
    const s = await svc.connect('h')
    expect(s.state).toBe('error')
    expect(s.error).toBe(
      'ไม่พบ git บนเครื่องนี้ — ติดตั้งก่อน เช่น sudo apt install git หรือ sudo dnf install git แล้วกด Reload'
    )
  })

  it('warns when git-remote-http is missing', async () => {
    const { svc } = make(ok('git=git version 2.43.0\nremotehttp=0\n'))
    const s = await svc.connect('h')
    expect(s.state).toBe('connected')
    expect(s.warnings).toEqual(['git บนเครื่องนี้ไม่รองรับ HTTP — push/pull จาก terminal ของแอปจะใช้ไม่ได้'])
  })

  it('warns when forward check fails', async () => {
    const { svc } = make(ok('git=git version 2.43.0\nremotehttp=1\n'), false)
    const s = await svc.connect('h')
    expect(s.state).toBe('connected')
    expect(s.warnings).toEqual(['sshd ปิด AllowTcpForwarding — push/pull จาก terminal ของแอปจะใช้ไม่ได้'])
  })

  it('treats exit 255 as ssh failure with stderr', async () => {
    const { svc } = make({ code: 255, stdout: '', stderr: 'Permission denied' })
    const s = await svc.connect('h1')
    expect(s.state).toBe('error')
    expect(s.error).toBe('Permission denied\nลองรัน ssh ai-box ใน terminal ของระบบก่อน')
  })

  it('treats exec rejection as ssh failure', async () => {
    const { svc } = make(new Error('spawn ssh ENOENT'))
    const s = await svc.connect('h')
    expect(s.state).toBe('error')
    expect(s.error).toContain('spawn ssh ENOENT')
    expect(s.error).toContain('ลองรัน ssh ai-box ใน terminal ของระบบก่อน')
  })

  it('returns the in-flight promise while connecting', async () => {
    const { svc } = make(ok('git=git version 2.43.0\nremotehttp=1\n'))
    const a = svc.connect('h')
    const b = svc.connect('h')
    expect(b).toBe(a)
    await a
  })

  it('disconnect resets state and calls onDisconnect', async () => {
    const { svc, onDisconnect } = make(ok('git=git version 2.43.0\nremotehttp=1\n'))
    await svc.connect('h')
    svc.disconnect('h')
    expect(svc.status('h')).toEqual({ state: 'disconnected', warnings: [] })
    expect(onDisconnect).toHaveBeenCalledWith('h')
  })

  it('requireConnected throws when not connected', () => {
    expect(() => make(ok('')).svc.requireConnected('h')).toThrow('Host ยังไม่ได้ connect')
  })
})
