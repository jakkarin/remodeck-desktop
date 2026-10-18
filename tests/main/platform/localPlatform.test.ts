import { describe, expect, it } from 'vitest'
import {
  linuxPlatform,
  localPlatformFor,
  macPlatform,
  windowsPlatform
} from '../../../src/main/platform/localPlatform'
import { LocalTarget } from '../../../src/main/sandbox/target'

const only =
  (...paths: string[]) =>
  (p: string): boolean =>
    paths.includes(p.replaceAll('\\', '/'))

describe('localPlatformFor', () => {
  it('picks one platform per OS', () => {
    expect(localPlatformFor('win32')).toBe(windowsPlatform)
    expect(localPlatformFor('darwin')).toBe(macPlatform)
    expect(localPlatformFor('linux')).toBe(linuxPlatform)
    expect(localPlatformFor('freebsd')).toBe(linuxPlatform)
  })
})

describe('windowsPlatform.resolveBash', () => {
  it('prefers Program Files Git bash', () => {
    const bash = 'C:/Program Files/Git/bin/bash.exe'
    expect(
      windowsPlatform.resolveBash({
        exists: only(bash),
        pathEnv: '',
        programFiles: ['C:/Program Files']
      })
    ).toBe(bash)
  })

  it('derives bash from git on PATH', () => {
    expect(
      windowsPlatform
        .resolveBash({
          exists: only('E:/tools/Git/cmd/git.exe', 'E:/tools/Git/bin/bash.exe'),
          pathEnv: 'C:/Windows;E:/tools/Git/cmd',
          programFiles: ['C:/Program Files']
        })
        ?.replaceAll('\\', '/')
    ).toBe('E:/tools/Git/bin/bash.exe')
  })

  it('ignores bash on PATH that is not next to git', () => {
    expect(
      windowsPlatform.resolveBash({
        exists: only('C:/Windows/System32/bash.exe'),
        pathEnv: 'C:/Windows/System32',
        programFiles: ['C:/Program Files']
      })
    ).toBeNull()
  })
})

describe('POSIX resolveBash', () => {
  it('prefers /bin/bash', () => {
    expect(
      linuxPlatform.resolveBash({
        exists: only('/bin/bash', '/usr/local/bin/bash'),
        pathEnv: '/usr/local/bin:/usr/bin'
      })
    ).toBe('/bin/bash')
  })

  it('falls back to bash on PATH split by colons', () => {
    expect(
      macPlatform.resolveBash({
        exists: only('/opt/homebrew/bin/bash'),
        pathEnv: '/usr/bin::/opt/homebrew/bin/'
      })
    ).toBe('/opt/homebrew/bin/bash')
  })

  it('never looks for Git for Windows', () => {
    expect(
      linuxPlatform.resolveBash({
        exists: only('C:/Program Files/Git/bin/bash.exe'),
        pathEnv: '',
        programFiles: ['C:/Program Files']
      })
    ).toBeNull()
  })
})

describe('windowsPlatform paths', () => {
  it('accepts drive paths, ~/ and Git Bash /d/x', () => {
    for (const ok of ['D:/x', 'D:\\x\\y', 'c:/Users/a b', '~/x', '/d/develop/app'])
      expect(() => windowsPlatform.validatePath(ok), ok).not.toThrow()
    for (const bad of ['D:/', 'D:', 'D:\\', 'x', 'D:x'])
      expect(() => windowsPlatform.validatePath(bad), bad).toThrow()
  })

  it('rejects POSIX-only paths', () => {
    for (const bad of ['/tmp/x', '/home/me/app', '/srv/app'])
      expect(() => windowsPlatform.validatePath(bad)).toThrow(
        'Use a Windows path like D:/projects/app'
      )
  })

  it('normalizePath cleans drive and msys paths', () => {
    expect(windowsPlatform.normalizePath('d:\\develop\\app\\')).toBe('D:/develop/app')
    expect(windowsPlatform.normalizePath('~/repos/a')).toBe('~/repos/a')
    expect(windowsPlatform.normalizePath('/d/develop/app')).toBe('D:/develop/app')
    expect(windowsPlatform.normalizePath('/c')).toBe('C:/')
  })

  it('normalizePath expands ~ when given a home dir', () => {
    expect(windowsPlatform.normalizePath('~/repos/a', 'c:\\Users\\x\\')).toBe('C:/Users/x/repos/a')
    expect(windowsPlatform.normalizePath('~', 'C:/Users/x')).toBe('C:/Users/x')
  })

  it('samePath matches ~ and the absolute home path, ignoring case', () => {
    expect(windowsPlatform.samePath('~/repos/app', 'c:/users/x/repos/app', 'C:/Users/x')).toBe(true)
    expect(windowsPlatform.samePath('D:/Dev/App', 'd:\\dev\\app\\')).toBe(true)
  })

  it('opens the folder dialog at Windows paths', () => {
    expect(windowsPlatform.looksLikePath('/srv/app')).toBe(false)
    expect(windowsPlatform.looksLikePath('/d/app')).toBe(true)
    expect(windowsPlatform.toDialogPath('C:/Users/x')).toBe('C:\\Users\\x')
  })
})

describe('POSIX paths', () => {
  it('accepts POSIX paths and rejects drive paths', () => {
    for (const ok of ['/home/me/app', '/tmp/x', '/d/x', '~/x'])
      expect(() => linuxPlatform.validatePath(ok), ok).not.toThrow()
    for (const bad of ['D:/x', 'D:\\x', '/', 'x'])
      expect(() => linuxPlatform.validatePath(bad), bad).toThrow('Path must start with / or ~/')
  })

  it('normalizePath keeps POSIX paths as they are', () => {
    expect(linuxPlatform.normalizePath('/d/develop/app/')).toBe('/d/develop/app')
    expect(linuxPlatform.normalizePath('/Home/a\\b')).toBe('/Home/a\\b')
    expect(linuxPlatform.normalizePath('/')).toBe('/')
    expect(linuxPlatform.normalizePath('~/repos/a', '/home/me/')).toBe('/home/me/repos/a')
    expect(macPlatform.normalizePath('~', '/home/me')).toBe('/home/me')
  })

  it('samePath ignores case on macOS but not Linux', () => {
    expect(linuxPlatform.samePath('~/app', '/home/me/app/', '/home/me')).toBe(true)
    expect(linuxPlatform.samePath('/srv/App', '/srv/app')).toBe(false)
    expect(macPlatform.samePath('/Users/me/App', '/users/me/app')).toBe(true)
  })

  it('folds case in shell scripts only on Windows (macOS /bin/bash is 3.2)', () => {
    expect(windowsPlatform.shellFoldsCase).toBe(true)
    expect(linuxPlatform.shellFoldsCase).toBe(false)
    expect(macPlatform.shellFoldsCase).toBe(false)
  })

  it('opens the folder dialog at any absolute or ~ path, unchanged', () => {
    expect(linuxPlatform.looksLikePath('/srv/app')).toBe(true)
    expect(linuxPlatform.looksLikePath('D:/app')).toBe(false)
    expect(linuxPlatform.toDialogPath('/home/me')).toBe('/home/me')
  })
})

describe('LocalTarget without bash', () => {
  it('rejects with the platform message', async () => {
    await expect(new LocalTarget('C:/h', null, windowsPlatform).exec('true')).rejects.toThrow(
      'Git for Windows is required: install it from https://git-scm.com'
    )
    await expect(new LocalTarget('/home/h', null, linuxPlatform).exec('true')).rejects.toThrow(
      'bash is required: install it with your package manager'
    )
  })
})
