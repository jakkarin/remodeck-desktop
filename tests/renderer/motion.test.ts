import { describe, expect, it } from 'vitest'
import { DURATION, transitionFor } from '../../src/renderer/src/motion'

describe('transitionFor', () => {
  it('uses the spec springs', () => {
    expect(transitionFor('enter', false)).toEqual({ type: 'spring', stiffness: 520, damping: 40 })
    expect(transitionFor('layout', false)).toEqual({ type: 'spring', stiffness: 400, damping: 36 })
  })
  it('uses the spec tweens', () => {
    expect(transitionFor('fast', false)).toEqual({ duration: 0.12, ease: 'easeOut' })
    expect(transitionFor('exit', false)).toEqual({ duration: 0.12, ease: 'easeIn' })
  })
  it('reduced motion: transforms snap, opacity keeps 80 ms', () => {
    for (const k of ['fast', 'enter', 'exit', 'layout'] as const)
      expect(transitionFor(k, true)).toEqual({ duration: 0, opacity: { duration: 0.08 } })
  })
  it('exposes the durations', () => {
    expect(DURATION).toEqual({ fast: 0.12, enter: 0.18, exit: 0.12, layout: 0.22 })
  })
})
