import { useCallback, useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react'
import { readJson, writeJson } from '../storage'

const KEY = 'regit.layout'
const MIN_COL = 160
const MIN_BOTTOM = 80
const SEP = 6

export interface LayoutState {
  left: number
  middle: number
  bottom: number
  collapsed: boolean
}

const DEFAULTS: LayoutState = { left: 240, middle: 320, bottom: 260, collapsed: false }

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

export function readLayout(): LayoutState {
  const v = readJson<Partial<LayoutState> | null>(KEY, null)
  if (!v || typeof v !== 'object') return { ...DEFAULTS }
  return {
    left: num(v.left, DEFAULTS.left),
    middle: num(v.middle, DEFAULTS.middle),
    bottom: num(v.bottom, DEFAULTS.bottom),
    collapsed: v.collapsed === true
  }
}

export function saveCollapsed(collapsed: boolean): void {
  writeJson(KEY, { ...readLayout(), collapsed })
}

type Handle = 'left' | 'middle' | 'bottom'

interface Props {
  left: ReactNode
  middle: ReactNode
  right: ReactNode
  bottom: ReactNode
  bottomCollapsed: boolean
}

export function SplitLayout({
  left,
  middle,
  right,
  bottom,
  bottomCollapsed
}: Props): React.JSX.Element {
  const [sizes, setSizes] = useState<LayoutState>(() => readLayout())
  const latest = useRef(sizes)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    latest.current = sizes
  }, [sizes])

  const startDrag = useCallback((handle: Handle, e: PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const startPos = handle === 'bottom' ? e.clientY : e.clientX
    const base = latest.current
    const startSize = base[handle]
    const min = handle === 'bottom' ? MIN_BOTTOM : MIN_COL
    // Measured at drag start; a 0 size (no layout, e.g. jsdom) means no maximum.
    const rect = rootRef.current?.getBoundingClientRect()
    let max = Infinity
    if (rect && handle === 'bottom' && rect.height > 0) max = rect.height - MIN_COL
    else if (rect && handle !== 'bottom' && rect.width > 0) {
      const other = handle === 'left' ? base.middle : base.left
      max = rect.width - other - MIN_COL - 2 * SEP
    }

    const onMove = (ev: globalThis.PointerEvent): void => {
      const pos = handle === 'bottom' ? ev.clientY : ev.clientX
      const delta = handle === 'bottom' ? startPos - pos : pos - startPos
      const next = Math.max(min, Math.min(max, startSize + delta))
      const updated = { ...latest.current, [handle]: next }
      latest.current = updated
      setSizes(updated)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      writeJson(KEY, latest.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const rows = bottomCollapsed ? 'minmax(0, 1fr) auto' : `minmax(0, 1fr) 6px ${sizes.bottom}px`

  return (
    <div
      className="split-root"
      ref={rootRef}
      data-testid="split-root"
      style={{
        gridTemplateColumns: `${sizes.left}px 6px ${sizes.middle}px 6px minmax(${MIN_COL}px, 1fr)`,
        gridTemplateRows: rows
      }}
    >
      <div className="split-slot" style={{ gridColumn: 1, gridRow: 1 }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize branches"
        className="split-sep split-sep-v"
        style={{ gridColumn: 2, gridRow: 1 }}
        onPointerDown={(e) => startDrag('left', e)}
      />
      <div className="split-slot" style={{ gridColumn: 3, gridRow: 1 }}>
        {middle}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize changes"
        className="split-sep split-sep-v"
        style={{ gridColumn: 4, gridRow: 1 }}
        onPointerDown={(e) => startDrag('middle', e)}
      />
      <div className="split-slot" style={{ gridColumn: 5, gridRow: 1 }}>
        {right}
      </div>
      {!bottomCollapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal"
          className="split-sep split-sep-h"
          style={{ gridColumn: '1 / -1', gridRow: 2 }}
          onPointerDown={(e) => startDrag('bottom', e)}
        />
      )}
      <div
        className="split-slot split-bottom"
        style={{ gridColumn: '1 / -1', gridRow: bottomCollapsed ? 2 : 3 }}
      >
        {bottom}
      </div>
    </div>
  )
}
