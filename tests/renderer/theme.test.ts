import { describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  restoreCachedTheme,
  watchColorScheme,
  xtermTheme
} from '../../src/renderer/src/theme'

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

describe('watchColorScheme data-theme', () => {
  it('fires when data-theme changes and stops after unsubscribe', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    )
    const cb = vi.fn()
    const off = watchColorScheme(cb)
    document.documentElement.dataset.theme = 'dark'
    await new Promise((r) => setTimeout(r, 0))
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    document.documentElement.dataset.theme = 'light'
    await new Promise((r) => setTimeout(r, 0))
    expect(cb).toHaveBeenCalledTimes(1)
    delete document.documentElement.dataset.theme
    vi.unstubAllGlobals()
  })
})

describe('applyTheme', () => {
  it('sets data-theme when forced and removes it for system', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    applyTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

describe('restoreCachedTheme', () => {
  it('re-applies the last forced theme and ignores system', () => {
    applyTheme('dark')
    delete document.documentElement.dataset.theme
    restoreCachedTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
    applyTheme('system')
    restoreCachedTheme()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})
