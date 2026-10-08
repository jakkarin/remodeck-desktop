import type { PointerEvent } from 'react'

export interface DragResize {
  axis: 'x' | 'y'
  /** Size when the drag starts. */
  start: number
  min: number
  /** Measured at drag start; Infinity means no maximum. */
  max: number
  /** True when moving the pointer towards the origin (left / up) grows the size. */
  invert: boolean
  onChange: (size: number) => void
  onEnd: (size: number) => void
}

export function startDragResize(e: PointerEvent<HTMLElement>, o: DragResize): void {
  e.preventDefault()
  const origin = o.axis === 'y' ? e.clientY : e.clientX
  let size = o.start
  const onMove = (ev: globalThis.PointerEvent): void => {
    const pos = o.axis === 'y' ? ev.clientY : ev.clientX
    const delta = o.invert ? origin - pos : pos - origin
    size = Math.max(o.min, Math.min(o.max, o.start + delta))
    o.onChange(size)
  }
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    o.onEnd(size)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}
