import type { BranchInfo } from '../../shared/types'
import { readJson, writeJson } from './storage'

export type SeenMap = Record<string, Record<string, string>>

const KEY = 'regit.seen'

export function markBaseline(m: SeenMap, wsId: string, branches: BranchInfo[]): SeenMap {
  if (m[wsId]) return m
  const shas: Record<string, string> = {}
  for (const b of branches) shas[b.name] = b.sha
  return { ...m, [wsId]: shas }
}

export function isNew(m: SeenMap, wsId: string, b: BranchInfo): boolean {
  const ws = m[wsId]
  if (!ws) return false
  return ws[b.name] !== b.sha
}

export function markSeen(m: SeenMap, wsId: string, b: BranchInfo): SeenMap {
  return { ...m, [wsId]: { ...(m[wsId] ?? {}), [b.name]: b.sha } }
}

export function loadSeen(): SeenMap {
  const v = readJson<unknown>(KEY, {})
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as SeenMap) : {}
}

export function saveSeen(m: SeenMap): void {
  writeJson(KEY, m)
}
