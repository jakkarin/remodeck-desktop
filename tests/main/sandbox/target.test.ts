import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  symlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalTarget, SshTarget, sshExecArgs } from '../../../src/main/sandbox/target'
import { shPath, shQuote } from '../../../src/main/sandbox/shell'

describe('SshTarget', () => {
  it('sshExecArgs', () => {
    expect(sshExecArgs('box')).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      'box',
      'bash',
      '-s'
    ])
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
  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(home, { recursive: true, force: true })
  })

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
  it('starts in the isolated home so relative writes stay there', async () => {
    const r = await new LocalTarget(home).exec('printf isolated > relative-file')
    expect(r.code).toBe(0)
    expect(readFileSync(join(home, 'relative-file'), 'utf8')).toBe('isolated')
  })
  it('does not execute an inherited Bash startup hook', async () => {
    const startup = join(home, 'startup.sh').replaceAll('\\', '/')
    const marker = join(home, 'startup-ran').replaceAll('\\', '/')
    writeFileSync(startup, `printf unsafe > ${shQuote(marker)}\n`)
    vi.stubEnv('BASH_ENV', startup)
    vi.stubEnv('ENV', startup)
    const r = await new LocalTarget(home).exec('echo isolated')
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('isolated\n')
    expect(existsSync(marker)).toBe(false)
  })
  it('redirects XDG config writes away from an inherited directory', async () => {
    const inheritedConfig = join(home, 'inherited-config')
    mkdirSync(inheritedConfig)
    vi.stubEnv('XDG_CONFIG_HOME', inheritedConfig)
    const r = await new LocalTarget(home).exec(
      'mkdir -p "$XDG_CONFIG_HOME" && printf isolated > "$XDG_CONFIG_HOME/probe"'
    )
    expect(r.code).toBe(0)
    expect(readFileSync(join(home, '.config', 'probe'), 'utf8')).toBe('isolated')
    expect(existsSync(join(inheritedConfig, 'probe'))).toBe(false)
  })
  it('canonicalizes an isolated junction and quotes an apostrophe in HOME', async () => {
    const physical = join(home, "it's isolated")
    const alias = join(home, 'alias')
    mkdirSync(physical)
    symlinkSync(physical, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const r = await new LocalTarget(alias).exec('printf isolated > "$HOME/probe"')
    expect(r.code).toBe(0)
    expect(readFileSync(join(physical, 'probe'), 'utf8')).toBe('isolated')
  })
  it('keeps an inherited global Git config untouched while honoring isolated XDG config', async () => {
    const sentinel = join(home, 'inherited.gitconfig')
    const original = '[sentinel]\n\tvalue = untouched\n'
    writeFileSync(sentinel, original)
    vi.stubEnv('GIT_CONFIG_GLOBAL', sentinel)
    const xdgGit = join(home, '.config', 'git')
    mkdirSync(xdgGit, { recursive: true })
    writeFileSync(join(xdgGit, 'config'), '[isolation]\n\tprobe = original\n')
    const r = await new LocalTarget(home).exec('git config --global isolation.probe isolated')
    expect(r.code).toBe(0)
    expect(readFileSync(sentinel, 'utf8')).toBe(original)
    expect(readFileSync(join(xdgGit, 'config'), 'utf8')).toContain('probe = isolated')
    expect(existsSync(join(home, '.gitconfig'))).toBe(false)
  })
})
