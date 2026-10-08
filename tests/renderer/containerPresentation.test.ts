import { describe, it, expect } from 'vitest'
import type { ContainerState } from '../../src/shared/containers'
import { capitalise, stateTone } from '../../src/renderer/src/containerPresentation'

describe('stateTone', () => {
  it.each<[ContainerState, string]>([
    ['running', 'success'],
    ['paused', 'warning'],
    ['restarting', 'warning'],
    ['dead', 'danger'],
    ['created', 'neutral'],
    ['removing', 'neutral'],
    ['exited', 'neutral']
  ])('maps %s to %s', (state, tone) => {
    expect(stateTone[state]).toBe(tone)
  })
})

describe('capitalise', () => {
  it('upper-cases the first letter only', () => {
    expect(capitalise('running')).toBe('Running')
    expect(capitalise('')).toBe('')
  })
})
