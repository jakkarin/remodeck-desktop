import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  SplitLayout,
  readLayout,
  saveCollapsed
} from '../../src/renderer/src/components/SplitLayout'

const renderLayout = (collapsed = false) =>
  render(
    <SplitLayout
      left={<div>L</div>}
      middle={<div>M</div>}
      right={<div>R</div>}
      bottom={<div>B</div>}
      bottomCollapsed={collapsed}
    />
  )

const drag = (sep: HTMLElement, from: number, to: number, axis: 'x' | 'y' = 'x'): void => {
  const pos = (v: number): object => (axis === 'x' ? { clientX: v } : { clientY: v })
  fireEvent.pointerDown(sep, pos(from))
  fireEvent.pointerMove(window, pos(to))
  fireEvent.pointerUp(window, pos(to))
}

const stored = (): Record<string, unknown> =>
  JSON.parse(localStorage.getItem('regit.layout') ?? '{}')

describe('SplitLayout', () => {
  afterEach(() => localStorage.clear())

  it('renders the four slots and three separators', () => {
    renderLayout()
    for (const t of ['L', 'M', 'R', 'B']) expect(screen.getByText(t)).toBeInTheDocument()
    expect(screen.getAllByRole('separator')).toHaveLength(3)
  })

  it('dragging the first separator widens left and persists', () => {
    renderLayout()
    drag(screen.getAllByRole('separator')[0], 100, 150)
    expect(stored().left).toBe(290)
    expect(readLayout().left).toBe(290)
  })

  it('remount reads persisted sizes', () => {
    const { unmount } = renderLayout()
    drag(screen.getAllByRole('separator')[0], 100, 150)
    unmount()
    renderLayout()
    expect(screen.getByTestId('split-root').style.gridTemplateColumns).toContain('290px')
  })

  it('clamps to the 160px minimum', () => {
    renderLayout()
    drag(screen.getAllByRole('separator')[0], 500, 0)
    expect(readLayout().left).toBe(160)
  })

  it('dragging the horizontal separator up grows the terminal', () => {
    renderLayout()
    drag(screen.getAllByRole('separator')[2], 500, 450, 'y')
    expect(readLayout().bottom).toBe(310)
  })

  it('falls back to defaults on corrupt JSON', () => {
    localStorage.setItem('regit.layout', '{nope')
    expect(readLayout()).toEqual({ left: 240, middle: 320, bottom: 260, collapsed: false })
  })

  it('saveCollapsed persists and keeps sizes', () => {
    saveCollapsed(true)
    expect(readLayout()).toEqual({ left: 240, middle: 320, bottom: 260, collapsed: true })
  })

  it('hides the horizontal separator when collapsed', () => {
    renderLayout(true)
    expect(screen.getAllByRole('separator')).toHaveLength(2)
  })
})
