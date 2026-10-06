import { describe, it, expect } from 'vitest'
import { parseHostPatch } from '../../src/main/app'

describe('parseHostPatch', () => {
  it('rejects an empty patch', () => {
    expect(() => parseHostPatch({})).toThrow('Invalid host patch')
  })
  it('rejects non-objects and wrongly typed fields', () => {
    expect(() => parseHostPatch(null)).toThrow('Invalid host patch')
    expect(() => parseHostPatch([])).toThrow('Invalid host patch')
    expect(() => parseHostPatch({ protected: 'x' })).toThrow('Invalid host patch')
    expect(() => parseHostPatch({ label: 5 })).toThrow('Invalid host patch')
  })
  it('accepts label and protected', () => {
    expect(parseHostPatch({ label: 'a' })).toEqual({ label: 'a', protected: undefined })
    expect(parseHostPatch({ protected: false })).toEqual({ label: undefined, protected: false })
  })
})
