import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import { runProcess } from '../../../src/main/proc/run'
import { LocalTarget } from '../../../src/main/sandbox/target'
import { shQuote } from '../../../src/main/sandbox/shell'

// Never launch the old unsafe PATH bash while establishing the regressions.
vi.mock('../../../src/main/proc/run', () => ({ runProcess: vi.fn() }))

describe('LocalTarget safety before launch', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'remodeck-safe-home-'))
    vi.mocked(runProcess).mockReset().mockResolvedValue({ code: 0, stdout: '', stderr: '' })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(home, { recursive: true, force: true })
  })

  it.each(['', '.', 'relative/home', parse(homedir()).root, homedir(), dirname(homedir())])(
    'rejects unsafe home %j before launching a process',
    (unsafeHome) => {
      expect(() => new LocalTarget(unsafeHome)).toThrow()
      expect(runProcess).not.toHaveBeenCalled()
    }
  )

  it('requires an existing directory', () => {
    const file = join(home, 'file')
    writeFileSync(file, '')
    expect(() => new LocalTarget(file)).toThrow()
    expect(() => new LocalTarget(join(home, 'missing'))).toThrow()
  })

  it('rejects a symlink or junction alias of the real home', () => {
    const alias = join(home, 'alias')
    symlinkSync(homedir(), alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => new LocalTarget(alias)).toThrow()
  })

  it('rejects an inherited HOME even when it differs from the OS home', () => {
    const inheritedHome = join(home, 'inherited')
    mkdirSync(inheritedHome)
    vi.stubEnv('HOME', inheritedHome)
    expect(() => new LocalTarget(inheritedHome)).toThrow()
  })

  it('rejects the actual account home when environment-dependent home lookup is overridden', async () => {
    const actualOs = await vi.importActual<typeof import('node:os')>('node:os')
    const accountHome = actualOs.userInfo().homedir
    const inheritedHome = parse(accountHome).root
    vi.stubEnv('HOME', inheritedHome)
    vi.stubEnv('USERPROFILE', inheritedHome)
    vi.resetModules()
    vi.doMock('node:os', () => ({ ...actualOs, homedir: () => inheritedHome }))
    try {
      const { LocalTarget: FreshLocalTarget } = await import('../../../src/main/sandbox/target')
      expect(() => new FreshLocalTarget(accountHome)).toThrow()
      expect(runProcess).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('node:os')
      vi.resetModules()
    }
  })

  it('removes inherited GIT_CONFIG_GLOBAL so Git uses the isolated home', async () => {
    vi.stubEnv('GIT_CONFIG_GLOBAL', join(home, 'inherited.gitconfig'))
    await new LocalTarget(home).exec('git config --global isolation.probe isolated')
    expect(vi.mocked(runProcess).mock.calls[0][2]?.env).not.toHaveProperty('GIT_CONFIG_GLOBAL')
  })

  it('removes shell startup hooks and uses an isolated working directory and XDG config', async () => {
    vi.stubEnv('BASH_ENV', join(home, 'startup.sh'))
    vi.stubEnv('ENV', join(home, 'startup.sh'))
    vi.stubEnv('XDG_CONFIG_HOME', join(home, 'inherited-config'))
    await new LocalTarget(home).exec('echo safe')
    const [command, args, opts] = vi.mocked(runProcess).mock.calls[0]
    expect(command).toBe(
      process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
    )
    expect(args).toEqual(['--noprofile', '--norc', '-s'])
    expect(opts?.cwd?.replaceAll('\\', '/')).toBe(home.replaceAll('\\', '/'))
    expect(opts?.env?.HOME).toBe(home.replaceAll('\\', '/'))
    expect(opts?.env?.XDG_CONFIG_HOME).toBe(`${home.replaceAll('\\', '/')}/.config`)
    expect(opts?.env).not.toHaveProperty('BASH_ENV')
    expect(opts?.env).not.toHaveProperty('ENV')
  })

  it('fails closed when the chosen shell is unavailable', async () => {
    vi.mocked(runProcess).mockRejectedValue(
      Object.assign(new Error('missing shell'), { code: 'ENOENT' })
    )
    await expect(new LocalTarget(home).exec('echo safe')).rejects.toThrow('missing shell')
    expect(runProcess).toHaveBeenCalledTimes(1)
  })

  it('aborts before the script when a launcher ignores HOME', async () => {
    const otherHome = join(home, 'other-home')
    const marker = join(home, 'script-ran').replaceAll('\\', '/')
    mkdirSync(otherHome)
    const { runProcess: realRunProcess } = await vi.importActual<
      typeof import('../../../src/main/proc/run')
    >('../../../src/main/proc/run')
    vi.mocked(runProcess).mockImplementation((_command, _args, opts) =>
      realRunProcess(
        process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash',
        ['--noprofile', '--norc', '-s'],
        { ...opts, cwd: home, env: { ...opts?.env, HOME: otherHome.replaceAll('\\', '/') } }
      )
    )
    const result = await new LocalTarget(home).exec(`printf unsafe > ${shQuote(marker)}`)
    expect(result.code).not.toBe(0)
    expect(existsSync(marker)).toBe(false)
  })

  it('rechecks a directory replaced with a junction to the real home before launch', async () => {
    const chosen = join(home, 'chosen')
    mkdirSync(chosen)
    const target = new LocalTarget(chosen)
    rmSync(chosen, { recursive: true })
    symlinkSync(homedir(), chosen, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(target.exec('echo safe')).rejects.toThrow()
    expect(runProcess).not.toHaveBeenCalled()
  })
})
