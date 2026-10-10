import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTerminalShortcut } from '../../src/renderer/src/useTerminalShortcut'

type Harness = {
  onToggle: ReturnType<typeof vi.fn>
  inner: ReturnType<typeof vi.fn>
  press: (init: KeyboardEventInit) => KeyboardEvent
  hook: ReturnType<typeof renderHook<void, { en?: boolean }>>
  target: HTMLTextAreaElement
}

function setup(enabled?: boolean): Harness {
  const onToggle = vi.fn()
  const hook = renderHook(({ en }: { en?: boolean }) => useTerminalShortcut(onToggle, en), {
    initialProps: { en: enabled }
  })
  const inner = vi.fn()
  const target = document.createElement('textarea') // xterm's helper textarea
  document.body.appendChild(target)
  target.addEventListener('keydown', inner)
  const press = (init: KeyboardEventInit): KeyboardEvent => {
    const e = new KeyboardEvent('keydown', {
      code: 'Backquote',
      key: '`',
      bubbles: true,
      cancelable: true,
      ...init
    })
    target.dispatchEvent(e)
    return e
  }
  return { onToggle, inner, press, hook, target }
}

describe('useTerminalShortcut', () => {
  it('Ctrl+` toggles and stops the key reaching the terminal', () => {
    const { onToggle, inner, press, target } = setup()
    const e = press({ ctrlKey: true })
    expect(onToggle).toHaveBeenCalledOnce()
    expect(inner).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(true)
    target.remove()
  })

  it('ignores a plain backtick, Ctrl+Shift+`, Ctrl+Alt+`, Meta and repeats', () => {
    const { onToggle, inner, press, target } = setup()
    press({})
    press({ ctrlKey: true, shiftKey: true })
    press({ ctrlKey: true, altKey: true })
    press({ ctrlKey: true, metaKey: true })
    press({ ctrlKey: true, repeat: true })
    expect(onToggle).not.toHaveBeenCalled()
    expect(inner).toHaveBeenCalledTimes(5)
    target.remove()
  })

  it('does nothing while disabled and re-enables', () => {
    const { onToggle, press, hook, target } = setup(false)
    press({ ctrlKey: true })
    expect(onToggle).not.toHaveBeenCalled()
    hook.rerender({ en: true })
    press({ ctrlKey: true })
    expect(onToggle).toHaveBeenCalledOnce()
    target.remove()
  })

  it('removes the listener on unmount', () => {
    const { onToggle, press, hook, target } = setup()
    hook.unmount()
    press({ ctrlKey: true })
    expect(onToggle).not.toHaveBeenCalled()
    target.remove()
  })
})
