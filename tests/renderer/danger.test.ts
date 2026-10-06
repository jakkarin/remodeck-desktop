import { describe, it, expect } from 'vitest'
import { dangerLevel, type DangerAction } from '../../src/renderer/src/danger'

type Level = 'none' | 'click' | 'type'
const table: Record<DangerAction, [Level, Level]> = {
  start: ['none', 'none'],
  logs: ['none', 'none'],
  shell: ['none', 'none'],
  inspect: ['none', 'none'],
  stop: ['none', 'click'],
  restart: ['none', 'click'],
  'compose-up': ['none', 'click'],
  'compose-pull': ['none', 'click'],
  'compose-restart': ['none', 'click'],
  remove: ['click', 'type'],
  'compose-down': ['click', 'type'],
  'image-rm': ['click', 'type'],
  'image-prune': ['click', 'type'],
  'network-rm': ['click', 'type'],
  'network-prune': ['click', 'type'],
  'volume-rm': ['type', 'type'],
  'volume-prune': ['type', 'type']
}

describe('dangerLevel', () => {
  for (const [action, [normal, prot]] of Object.entries(table) as [
    DangerAction,
    [Level, Level]
  ][]) {
    it(`${action}: ${normal} / protected ${prot}`, () => {
      expect(dangerLevel(action, false)).toBe(normal)
      expect(dangerLevel(action, true)).toBe(prot)
    })
  }
})
