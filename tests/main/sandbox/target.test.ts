import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalTarget, SshTarget, sshExecArgs } from '../../../src/main/sandbox/target'
import { shPath } from '../../../src/main/sandbox/shell'
import { localPlatform } from '../../../src/main/platform/localPlatform'

const windowsOnly = it.skipIf(process.platform !== 'win32')
const posixOnly = it.skipIf(process.platform === 'win32')

describe('SshTarget', () => {
  it('sshExecArgs', () => {
    expect(sshExecArgs('box')).toEqual(['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'box', 'bash', '-s'])
  })
  it('gitUrl', () => {
    const t = new SshTarget('box', 'ssh')
    expect(t.gitUrl('~/x')).toBe('ssh://box/~/x')
    expect(t.gitUrl('/srv/x')).toBe('ssh://box/srv/x')
  })
})

describe('LocalTarget', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'remodeck-x-')).replaceAll('\\', '/')
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('runs a script with HOME=homeDir', async () => {
    const t = new LocalTarget(home)
    const r = await t.exec('mkdir -p ' + shPath('~/a b') + ' && echo ok')
    expect(r.stderr).toBe('')
    expect(r.stdout).toBe('ok\n')
    expect(existsSync(join(home, 'a b'))).toBe(true)
  })
  it('round-trips a path containing an apostrophe through bash', async () => {
    const t = new LocalTarget(home)
    const r = await t.exec('mkdir -p ' + shPath("~/it's here") + ' && echo ok')
    expect(r.stdout).toBe('ok\n')
    expect(existsSync(join(home, "it's here"))).toBe(true)
  })
  windowsOnly(
    'runs under Git for Windows bash with HOME=homeDir, even when PATH lists another bash first',
    async () => {
      const savedPath = process.env.PATH
      process.env.PATH = `${process.env.SystemRoot ?? 'C:/Windows'}\\System32;${savedPath}`
      try {
        const r = await new LocalTarget(home).exec('uname -s; cygpath -m "$HOME"')
        const [system, scriptHome] = r.stdout.trim().split('\n')
        expect(system).toMatch(/^(MINGW|MSYS)/)
        expect(scriptHome.toLowerCase()).toBe(home.toLowerCase())
      } finally {
        process.env.PATH = savedPath
      }
    }
  )
  posixOnly('runs under a POSIX bash with HOME=homeDir', async () => {
    const r = await new LocalTarget(home).exec('uname -s; printf "%s\\n" "$HOME" "$BASH"')
    const [system, scriptHome, bash] = r.stdout.trim().split('\n')
    expect(system).not.toMatch(/^(MINGW|MSYS)/)
    expect(scriptHome).toBe(home)
    expect(bash).toMatch(/\/bash$/)
  })
  it('rejects without running anything when bash is missing', async () => {
    await expect(new LocalTarget(home, null).exec('touch "$HOME/ran"')).rejects.toThrow(
      localPlatform.bashMissing
    )
    expect(existsSync(join(home, 'ran'))).toBe(false)
  })
  it('gitUrl resolves ~', () => {
    const t = new LocalTarget(home)
    expect(t.gitUrl('~/x')).toBe(`${home}/x`)
    expect(t.gitUrl('/srv/x')).toBe('/srv/x')
  })
})
