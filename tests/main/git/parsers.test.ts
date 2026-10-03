import { describe, expect, it } from 'vitest'
import { countDirty, parseRefs, parseSymrefHead, parseWorktrees } from '../../../src/main/git/parsers'

describe('parsers', () => {
  it('parseSymrefHead', () => {
    expect(parseSymrefHead('ref: refs/heads/main\tHEAD\nabc\tHEAD\n')).toBe('main')
    expect(parseSymrefHead('')).toBeNull()
  })

  it('parseRefs', () => {
    const m = parseRefs('refs/heads/main\0abc\nrefs/heads/feat/a\0def\n\n')
    expect(m.get('refs/heads/main')).toBe('abc')
    expect(m.get('refs/heads/feat/a')).toBe('def')
    expect(m.size).toBe(2)
  })

  it('parseWorktrees', () => {
    const out =
      'worktree /w/main\nHEAD aaa\nbranch refs/heads/feat/a\n\nworktree /w/det\nHEAD bbb\ndetached\n'
    expect(parseWorktrees(out)).toEqual([
      { path: '/w/main', branch: 'feat/a', head: 'aaa' },
      { path: '/w/det', branch: null, head: 'bbb' }
    ])
  })

  it('countDirty', () => {
    expect(countDirty('# branch.oid x\n1 .M N... a\n? new.txt\n')).toBe(2)
    expect(countDirty('2 R. x\nu UU y\n! ign\n')).toBe(2)
    expect(countDirty('')).toBe(0)
  })
})
