import { describe, expect, it, vi } from 'vitest'
import { watchColorScheme, xtermTheme } from '../../src/renderer/src/theme'

describe('xtermTheme', () => {
  it('maps css tokens to xterm theme keys', () => {
    const vars: Record<string, string> = {
      '--bg-inset': '#010409',
      '--fg': '#e6edf3',
      '--selected-bg': '#303030',
      '--terminal-selection': '#3d4b60'
    }
    const theme = xtermTheme((name) => vars[name] ?? '')
    expect(theme).toEqual({
      background: '#010409',
      foreground: '#e6edf3',
      cursor: '#e6edf3',
      selectionBackground: '#3d4b60'
    })
  })
})

describe('watchColorScheme', () => {
  it('calls back on change and stops after unsubscribe', () => {
    let handler: (() => void) | null = null
    const mq = {
      addEventListener: vi.fn((_t: string, h: () => void) => {
        handler = h
      }),
      removeEventListener: vi.fn((_t: string, h: () => void) => {
        if (handler === h) handler = null
      })
    }
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mq)
    )
    const cb = vi.fn()
    const off = watchColorScheme(cb)
    handler?.()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    handler?.()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(mq.removeEventListener).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
