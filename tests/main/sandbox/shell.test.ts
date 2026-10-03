import { describe, it, expect } from 'vitest'
import { shQuote, shPath } from '../../../src/main/sandbox/shell'

describe('shell quoting', () => {
  it('shQuote escapes single quotes', () => {
    expect(shQuote("it's")).toBe(`'it'\''s'`)
  })
  it('shPath expands ~ and ~/rest', () => {
    expect(shPath('~')).toBe('"$HOME"')
    expect(shPath("~/my repos/it's")).toBe(`"$HOME"/'my repos/it'\''s'`)
  })
  it('shPath quotes other paths', () => {
    expect(shPath('/srv/a b')).toBe(`'/srv/a b'`)
  })
})
