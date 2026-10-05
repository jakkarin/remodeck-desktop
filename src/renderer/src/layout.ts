import { readJson, writeJson } from './storage'

export const LAYOUT_KEY = 'regit.layout'
export const MIN_COL = 160
export const MIN_BOTTOM = 80

export interface LayoutState {
  left: number
  middle: number
  bottom: number
  collapsed: boolean
}

export const DEFAULTS: LayoutState = { left: 240, middle: 320, bottom: 260, collapsed: false }

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

export function readLayout(): LayoutState {
  const v = readJson<Partial<LayoutState> | null>(LAYOUT_KEY, null)
  if (!v || typeof v !== 'object') return { ...DEFAULTS }
  return {
    left: num(v.left, DEFAULTS.left),
    middle: num(v.middle, DEFAULTS.middle),
    bottom: num(v.bottom, DEFAULTS.bottom),
    collapsed: v.collapsed === true
  }
}

export function saveCollapsed(collapsed: boolean): void {
  writeJson(LAYOUT_KEY, { ...readLayout(), collapsed })
}
