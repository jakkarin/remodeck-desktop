import { describe, expect, it } from 'vitest'
import { countDirty, parseFileChanges, parseRefs, parseSymrefHead, parseWorktrees } from '../../../src/main/git/parsers'

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

describe('parseFileChanges', () => {
  it('add and modify', () => {
    expect(parseFileChanges('3\t0\ta.txt\0' + '1\t1\tb.txt\0', 'A\0a.txt\0M\0b.txt\0')).toEqual([
      { path: 'a.txt', status: 'A', additions: 3, deletions: 0 },
      { path: 'b.txt', status: 'M', additions: 1, deletions: 1 }
    ])
  })

  it('delete', () => {
    expect(parseFileChanges('0\t4\tgone.txt\0', 'D\0gone.txt\0')).toEqual([
      { path: 'gone.txt', status: 'D', additions: 0, deletions: 4 }
    ])
  })

  it('rename', () => {
    expect(parseFileChanges('0\t0\t\0old name.txt\0ใหม่.txt\0', 'R100\0old name.txt\0ใหม่.txt\0')).toEqual([
      { path: 'ใหม่.txt', oldPath: 'old name.txt', status: 'R', additions: 0, deletions: 0 }
    ])
  })

  it('binary', () => {
    expect(parseFileChanges('-\t-\timg.png\0', 'M\0img.png\0')).toEqual([
      { path: 'img.png', status: 'M', additions: null, deletions: null }
    ])
  })

  it('maps copy and type change', () => {
    const r = parseFileChanges('1\t0\tc.txt\0' + '0\t0\tt.txt\0', 'C100\0src.txt\0c.txt\0T\0t.txt\0')
    expect(r.map((f) => f.status)).toEqual(['A', 'M'])
  })

  it('empty input', () => {
    expect(parseFileChanges('', '')).toEqual([])
  })
})
