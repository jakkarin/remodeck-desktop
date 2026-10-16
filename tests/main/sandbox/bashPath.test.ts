import { describe, expect, it } from 'vitest'
import { resolveBashPath } from '../../../src/main/proc/bashPath'
import { LocalTarget } from '../../../src/main/sandbox/target'

const only =
  (...paths: string[]) =>
  (p: string): boolean =>
    paths.includes(p.replaceAll('\\', '/'))

describe('resolveBashPath', () => {
  it('prefers Program Files Git bash', () => {
    const bash = 'C:/Program Files/Git/bin/bash.exe'
    expect(
      resolveBashPath({ exists: only(bash), pathEnv: '', programFiles: ['C:/Program Files'] })
    ).toBe(bash)
  })

  it('derives bash from git on PATH', () => {
    expect(
      resolveBashPath({
        exists: only('E:/tools/Git/cmd/git.exe', 'E:/tools/Git/bin/bash.exe'),
        pathEnv: 'C:/Windows;E:/tools/Git/cmd',
        programFiles: ['C:/Program Files']
      })?.replaceAll('\\', '/')
    ).toBe('E:/tools/Git/bin/bash.exe')
  })

  it('ignores bash on PATH that is not next to git', () => {
    expect(
      resolveBashPath({
        exists: only('C:/Windows/System32/bash.exe'),
        pathEnv: 'C:/Windows/System32',
        programFiles: ['C:/Program Files']
      })
    ).toBeNull()
  })
})

describe('LocalTarget without bash', () => {
  it('LocalTarget with null bash rejects', async () => {
    await expect(new LocalTarget('C:/h', null).exec('true')).rejects.toThrow(
      'Git for Windows is required: install it from https://git-scm.com'
    )
  })
})
