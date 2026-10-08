import { describe, it, expect } from 'vitest'
import { shQuote, shPath, validateSandboxPath } from '../../../src/main/sandbox/shell'

describe('shell quoting', () => {
  it('shQuote escapes single quotes', () => {
    expect(shQuote("it's")).toBe("'it'\\''s'")
  })
  it('shPath expands ~ and ~/rest', () => {
    expect(shPath('~')).toBe('"$HOME"')
    expect(shPath("~/my repos/it's")).toBe('"$HOME"/\'my repos/it\'\\\'\'s\'')
  })
  it('shPath quotes other paths', () => {
    expect(shPath('/srv/a b')).toBe(`'/srv/a b'`)
  })
})

describe('validateSandboxPath', () => {
  it('accepts absolute and ~/ subdirectory paths', () => {
    for (const ok of ['/srv/api', '~/repos/api', '~/x']) expect(() => validateSandboxPath(ok)).not.toThrow()
  })
  it('rejects relative, bare ~, ~/ and ~user paths', () => {
    for (const bad of ['', 'repos/api', './api', '../api', '~', '~/', '~user/api', '/']) {
      expect(() => validateSandboxPath(bad), bad).toThrow('Path must start with / or ~/')
    }
  })
})
