import { describe, it, expect } from 'vitest'
import type { ContainerInfo, ContainerState } from '../../src/shared/containers'
import {
  capitalise,
  formatCpu,
  formatMem,
  shortStatus,
  stateTone,
  statusTone
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
  it('switches to GB when the rounded MB value reaches 1024', () => {
    expect(formatMem(1073741823)).toBe('1.0 GB')
    expect(formatMem(1073741824 - 524289)).toBe('1023 MB')
  })
})

const ctr = (state: ContainerState, status: string): ContainerInfo =>
  ({ state, status }) as ContainerInfo

describe('shortStatus / statusTone', () => {
  it.each<[ContainerState, string, string]>([
    ['running', 'Up 9 hours', '9h'],
    ['running', 'Up 2 days (healthy)', '2d'],
    ['running', 'Up About an hour', '1h'],
    ['running', 'Up Less than a second', '<1s'],
    ['running', 'Up 45 seconds', '45s'],
    ['exited', 'Exited (1) 2 days ago', 'Exited (1)'],
    ['restarting', 'Restarting (1) 3 seconds ago', 'Restarting'],
    ['paused', 'Up 3 hours (Paused)', 'Paused']
  ])('%s "%s" → %s', (state, status, short) => {
    expect(shortStatus(ctr(state, status))).toBe(short)
  })
  it('marks a non-zero exit as danger and a clean one as neutral', () => {
    expect(statusTone(ctr('exited', 'Exited (1) 1 hour ago'))).toBe('danger')
    expect(statusTone(ctr('exited', 'Exited (0) 1 hour ago'))).toBe('neutral')
    expect(statusTone(ctr('restarting', 'Restarting'))).toBe('warning')
    expect(statusTone(ctr('running', 'Up 1 hour'))).toBe('neutral')
  })
})
