import { describe, it, expect } from 'vitest'
import type { ContainerState } from '../../src/shared/containers'
import {
  capitalise,
  formatCpu,
  formatMem,
  stateTone
} from '../../src/renderer/src/containerPresentation'

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

describe('formatCpu / formatMem', () => {
  it('formats cpu with one decimal and a percent sign', () => {
    expect(formatCpu(0.04)).toBe('0.0%')
    expect(formatCpu(2.12)).toBe('2.1%')
  })
  it('formats memory in MB below 1 GiB and GB from there', () => {
    expect(formatMem(1048576)).toBe('1 MB')
    expect(formatMem(41943040)).toBe('40 MB')
    expect(formatMem(1073741824)).toBe('1.0 GB')
  })
})
