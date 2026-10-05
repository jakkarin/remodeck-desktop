import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalTarget, SshTarget, sshExecArgs } from '../../../src/main/sandbox/target'
import { shPath } from '../../../src/main/sandbox/shell'

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
    home = mkdtempSync(join(tmpdir(), 'regit-x-')).replaceAll('\\', '/')
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
  it('gitUrl resolves ~', () => {
    const t = new LocalTarget(home)
    expect(t.gitUrl('~/x')).toBe(`${home}/x`)
    expect(t.gitUrl('/srv/x')).toBe('/srv/x')
  })
})
