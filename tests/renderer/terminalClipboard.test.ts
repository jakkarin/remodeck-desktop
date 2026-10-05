import { describe, it, expect, vi, type Mock } from 'vitest'
import { attachClipboard } from '../../src/renderer/src/terminalClipboard'

type KeyHandler = (e: KeyboardEvent) => boolean
type Clip = Parameters<typeof attachClipboard>[2]

type Setup = {
  term: {
    hasSelection: Mock
    getSelection: Mock
    clearSelection: Mock
    paste: Mock
    attachCustomKeyEventHandler: Mock
  }
  clipboard: { readText: Mock; writeText: Mock }
  el: HTMLElement
  dispose: () => void
  key: (init: KeyboardEventInit, type?: string) => { result: boolean; ev: KeyboardEvent }
  rightClick: () => MouseEvent
}

function setup(opts: { selection?: string; clip?: Partial<NonNullable<Clip>> } = {}): Setup {
  let handler: KeyHandler = () => true
  const term = {
    attachCustomKeyEventHandler: vi.fn((h: KeyHandler) => {
      handler = h
    }),
    hasSelection: vi.fn(() => !!opts.selection),
    getSelection: vi.fn(() => opts.selection ?? ''),
    clearSelection: vi.fn(),
    paste: vi.fn()
  }
  const clipboard = {
    readText: vi.fn(async () => 'clip'),
    writeText: vi.fn(async () => {}),
    ...opts.clip
  }
  const el = document.createElement('div')
  const dispose = attachClipboard(term, el, clipboard)
  const key = (
    init: KeyboardEventInit,
    type = 'keydown'
  ): { result: boolean; ev: KeyboardEvent } => {
    const ev = new KeyboardEvent(type, { cancelable: true, ...init })
    return { result: handler(ev), ev }
  }
  const rightClick = (): MouseEvent => {
    const ev = new MouseEvent('contextmenu', { cancelable: true, bubbles: true })
    el.dispatchEvent(ev)
    return ev
  }
  return { term, clipboard, el, dispose, key, rightClick }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const CS = { ctrlKey: true, shiftKey: true }

describe('attachClipboard', () => {
  it('Ctrl+Shift+C copies the selection and swallows the key', () => {
    const t = setup({ selection: 'abc' })
    const { result, ev } = t.key({ ...CS, code: 'KeyC' })
    expect(result).toBe(false)
    expect(ev.defaultPrevented).toBe(true)
    expect(t.clipboard.writeText).toHaveBeenCalledWith('abc')
  })

  it('Ctrl+Shift+C without a selection is a no-op', () => {
    const t = setup()
    expect(t.key({ ...CS, code: 'KeyC' }).result).toBe(false)
    expect(t.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('Ctrl+Shift+V pastes clipboard text via term.paste', async () => {
    const t = setup()
    const { result, ev } = t.key({ ...CS, code: 'KeyV' })
    expect(result).toBe(false)
    expect(ev.defaultPrevented).toBe(true)
    await flush()
    expect(t.term.paste).toHaveBeenCalledWith('clip')
  })

  it('Cmd+C / Cmd+V work too', async () => {
    const t = setup({ selection: 'x' })
    expect(t.key({ metaKey: true, code: 'KeyC' }).result).toBe(false)
    expect(t.clipboard.writeText).toHaveBeenCalledWith('x')
    expect(t.key({ metaKey: true, code: 'KeyV' }).result).toBe(false)
    await flush()
    expect(t.term.paste).toHaveBeenCalledWith('clip')
  })

  it('plain Ctrl+C / Ctrl+V go to the shell untouched', () => {
    const t = setup({ selection: 'abc' })
    for (const code of ['KeyC', 'KeyV']) {
      const { result, ev } = t.key({ ctrlKey: true, code })
      expect(result).toBe(true)
      expect(ev.defaultPrevented).toBe(false)
    }
    expect(t.clipboard.writeText).not.toHaveBeenCalled()
    expect(t.clipboard.readText).not.toHaveBeenCalled()
    expect(t.term.paste).not.toHaveBeenCalled()
  })

  it('keyup of a combo is swallowed without acting', () => {
    const t = setup({ selection: 'abc' })
    expect(t.key({ ...CS, code: 'KeyC' }, 'keyup').result).toBe(false)
    expect(t.key({ ...CS, code: 'KeyV' }, 'keyup').result).toBe(false)
    expect(t.clipboard.writeText).not.toHaveBeenCalled()
    expect(t.clipboard.readText).not.toHaveBeenCalled()
  })

  it('other keys pass through', () => {
    const t = setup()
    expect(t.key({ ...CS, code: 'KeyA' }).result).toBe(true)
  })

  it('right-click with a selection copies and clears it', () => {
    const t = setup({ selection: 'sel' })
    const ev = t.rightClick()
    expect(ev.defaultPrevented).toBe(true)
    expect(t.clipboard.writeText).toHaveBeenCalledWith('sel')
    expect(t.term.clearSelection).toHaveBeenCalled()
    expect(t.term.paste).not.toHaveBeenCalled()
  })

  it('right-click without a selection pastes', async () => {
    const t = setup()
    const ev = t.rightClick()
    expect(ev.defaultPrevented).toBe(true)
    await flush()
    expect(t.term.paste).toHaveBeenCalledWith('clip')
    expect(t.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('swallows clipboard rejections', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const t = setup({
      selection: 'abc',
      clip: {
        readText: vi.fn(() => Promise.reject(new Error('denied'))),
        writeText: vi.fn(() => Promise.reject(new Error('denied')))
      }
    })
    t.key({ ...CS, code: 'KeyC' })
    t.key({ ...CS, code: 'KeyV' })
    await flush()
    await flush()
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
    expect(t.term.paste).not.toHaveBeenCalled()
  })

  it('disposer removes the contextmenu listener', () => {
    const t = setup({ selection: 'sel' })
    t.dispose()
    const ev = t.rightClick()
    expect(ev.defaultPrevented).toBe(false)
    expect(t.clipboard.writeText).not.toHaveBeenCalled()
  })
})
