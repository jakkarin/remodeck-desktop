import { useCallback, useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react'
import { writeJson } from '../storage'
import { LAYOUT_KEY, MIN_BOTTOM, MIN_COL, readLayout, type LayoutState } from '../layout'

const SEP = 6

// Pane slots are cards on the ground color; the 6px separators between them stay transparent.
const CARD = 'min-h-0 min-w-0 overflow-hidden rounded-xl border border-border bg-background'
const SEP_BASE = 'touch-none rounded-full transition-colors hover:bg-(--accent)/40'

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
      writeJson(LAYOUT_KEY, latest.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  // The gap row stays when collapsed so the dock header keeps the same spacing as the panes.
  const rows = `minmax(0, 1fr) 6px ${bottomCollapsed ? 'auto' : `${sizes.bottom}px`}`

  return (
    <div
      className="grid h-full min-h-0"
      ref={rootRef}
      data-testid="split-root"
      style={{
        gridTemplateColumns: `${sizes.left}px 6px ${sizes.middle}px 6px minmax(${MIN_COL}px, 1fr)`,
        gridTemplateRows: rows
      }}
    >
      <div className={CARD} style={{ gridColumn: 1, gridRow: 1 }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize branches"
        className={`${SEP_BASE} cursor-col-resize`}
        style={{ gridColumn: 2, gridRow: 1 }}
        onPointerDown={(e) => startDrag('left', e)}
      />
      <div className={CARD} style={{ gridColumn: 3, gridRow: 1 }}>
        {middle}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize changes"
        className={`${SEP_BASE} cursor-col-resize`}
        style={{ gridColumn: 4, gridRow: 1 }}
        onPointerDown={(e) => startDrag('middle', e)}
      />
      <div className={CARD} style={{ gridColumn: 5, gridRow: 1 }}>
        {right}
      </div>
      {!bottomCollapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal"
          className={`${SEP_BASE} cursor-row-resize`}
          style={{ gridColumn: '1 / -1', gridRow: 2 }}
          onPointerDown={(e) => startDrag('bottom', e)}
        />
      )}
      <div className="min-h-0 min-w-0 overflow-hidden" style={{ gridColumn: '1 / -1', gridRow: 3 }}>
        {bottom}
      </div>
    </div>
  )
}
