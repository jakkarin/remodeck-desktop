import { describe, expect, it } from 'vitest'
import { cloneProgressTracker } from '../../../src/main/sync/cloneProgress'
import type { CloneProgress } from '../../../src/shared/types'

const track = (): { seen: CloneProgress[]; t: ReturnType<typeof cloneProgressTracker> } => {
  const seen: CloneProgress[] = []
  return { seen, t: cloneProgressTracker((p) => seen.push(p)) }
}

describe('cloneProgressTracker', () => {
  it('maps fetch and push stages onto one bar', () => {
    const { seen, t } = track()
    t.feed('remote: Counting objects: 100% (5/5), done.\nReceiving objects:  50% (5/10)\r')
    t.feed('Receiving objects: 100% (10/10), done.\nResolving deltas:  50% (1/2)\r')
    t.feed('Writing objects: 100% (10/10), done.\n')
    expect(seen).toEqual([
      { phase: 'fetch', percent: 25 },
      { phase: 'fetch', percent: 50 },
      { phase: 'fetch', percent: 55 },
      { phase: 'push', percent: 95 }
    ])
  })

  it('joins a line split across chunks and never goes back', () => {
    const { seen, t } = track()
    t.at('push', 60)
    t.feed('Receiving obj')
    t.feed('ects:  80% (8/10)\r')
    t.feed('Writing objects:  4')
    t.feed('0% (4/10)\r')
    expect(seen).toEqual([
      { phase: 'push', percent: 60 },
      { phase: 'push', percent: 74 }
    ])
  })
})
