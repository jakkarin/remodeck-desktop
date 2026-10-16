import { describe, it, expect } from 'vitest'
import {
  normalizeLocalPath,
  sameSandboxPath,
  shPath,
  shQuote,
  validateSandboxPath
} from '../../../src/main/sandbox/shell'

describe('shell quoting', () => {
  it('shQuote escapes single quotes', () => {
    expect(shQuote("it's")).toBe("'it'\\''s'")
  })
  it('shPath expands ~ and ~/rest', () => {
    expect(shPath('~')).toBe('"$HOME"')
    expect(shPath("~/my repos/it's")).toBe("\"$HOME\"/'my repos/it'\\''s'")
  })
  it('shPath quotes other paths', () => {
    expect(shPath('/srv/a b')).toBe(`'/srv/a b'`)
  })
})

describe('validateSandboxPath', () => {
  it('accepts absolute and ~/ subdirectory paths', () => {
    for (const ok of ['/srv/api', '~/repos/api', '~/x'])
      expect(() => validateSandboxPath(ok)).not.toThrow()
  })
  it('rejects relative, bare ~, ~/ and ~user paths', () => {
    for (const bad of ['', 'repos/api', './api', '../api', '~', '~/', '~user/api', '/']) {
      expect(() => validateSandboxPath(bad), bad).toThrow('Path must start with / or ~/')
    }
  })
})

describe('local paths', () => {
  it('accepts drive paths only for local', () => {
    for (const ok of ['D:/x', 'D:\\x\\y', 'c:/Users/a b'])
      expect(() => validateSandboxPath(ok, { local: true })).not.toThrow()
    expect(() => validateSandboxPath('~/x', { local: true })).not.toThrow()
    expect(() => validateSandboxPath('D:/x')).toThrow('Path must start with / or ~/')
    for (const bad of ['D:/', 'D:', 'D:\\', 'x', 'D:x'])
      expect(() => validateSandboxPath(bad, { local: true })).toThrow()
  })

  it('rejects POSIX-only paths on the local host', () => {
    for (const bad of ['/tmp/x', '/home/me/app', '/srv/app'])
      expect(() => validateSandboxPath(bad, { local: true })).toThrow(
        'Use a Windows path like D:/projects/app'
      )
    expect(() => validateSandboxPath('/d/develop/app', { local: true })).not.toThrow()
    expect(() => validateSandboxPath('/tmp/x')).not.toThrow()
  })

  it('normalizeLocalPath cleans drive paths', () => {
    expect(normalizeLocalPath('d:\\develop\\app\\')).toBe('D:/develop/app')
    expect(normalizeLocalPath('~/repos/a')).toBe('~/repos/a')
    expect(normalizeLocalPath('/home/x')).toBe('/home/x')
  })

  it('normalizeLocalPath converts msys paths', () => {
    expect(normalizeLocalPath('/d/develop/app')).toBe('D:/develop/app')
    expect(normalizeLocalPath('/c')).toBe('C:/')
  })

  it('shPath quotes a spaced drive path', () => {
    expect(shPath('C:/Users/Jane Doe/a')).toBe(`'C:/Users/Jane Doe/a'`)
  })

  it('normalizeLocalPath expands ~ when given a home dir', () => {
    expect(normalizeLocalPath('~/repos/a', 'c:\\Users\\x\\')).toBe('C:/Users/x/repos/a')
    expect(normalizeLocalPath('~', 'C:/Users/x')).toBe('C:/Users/x')
  })

  it('sameSandboxPath matches ~ and the absolute home path for local', () => {
    expect(sameSandboxPath('~/repos/app', 'c:/users/x/repos/app', true, 'C:/Users/x')).toBe(true)
  })

  it('sameSandboxPath ignores case only for local', () => {
    expect(sameSandboxPath('D:/Dev/App', 'd:\\dev\\app\\', true)).toBe(true)
    expect(sameSandboxPath('/srv/App', '/srv/app', false)).toBe(false)
    expect(sameSandboxPath('/srv/app/', '/srv/app', false)).toBe(true)
  })
})
