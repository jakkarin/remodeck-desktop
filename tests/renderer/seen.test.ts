import { describe, it, expect, vi, afterEach } from 'vitest'
import type { BranchInfo } from '../../src/shared/types'
import {
  markBaseline,
  isNew,
  markSeen,
  loadSeen,
  saveSeen
} from '../../src/renderer/src/seen'

const br = (name: string, sha: string): BranchInfo => ({
  name,
  sha,
  base: 'main',
  ahead: 0,
  behind: 0,
  merged: false,
  rewritten: false
})

describe('seen', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('first baseline marks nothing as new', () => {
    const bs = [br('a', '1'), br('b', '2')]
    const m = markBaseline({}, 'w', bs)
    expect(bs.some((b) => isNew(m, 'w', b))).toBe(false)
  })

  it('baseline is a no-op once the workspace exists', () => {
    const m = markBaseline({}, 'w', [br('a', '1')])
    expect(markBaseline(m, 'w', [br('a', '9')])).toBe(m)
  })

  it('changed sha and unseen branch are new', () => {
    const m = markBaseline({}, 'w', [br('a', '1')])
    expect(isNew(m, 'w', br('a', '2'))).toBe(true)
    expect(isNew(m, 'w', br('c', '3'))).toBe(true)
  })

  it('markSeen clears new', () => {
    const m = markBaseline({}, 'w', [br('a', '1')])
    const next = markSeen(m, 'w', br('a', '2'))
    expect(isNew(next, 'w', br('a', '2'))).toBe(false)
  })

  it('loadSeen survives getItem throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('x')
    })
    expect(loadSeen()).toEqual({})
  })

  it('saveSeen survives setItem throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('x')
    })
    expect(() => saveSeen({ w: { a: '1' } })).not.toThrow()
  })

  it('round trips', () => {
    saveSeen({ w: { a: '1' } })
    expect(loadSeen()).toEqual({ w: { a: '1' } })
  })
})
