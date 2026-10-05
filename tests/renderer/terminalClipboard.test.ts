import { describe, it, expect, vi, type Mock } from 'vitest'
import {
  attachClipboard,
  attachImageDrop,
  formatPath
} from '../../src/renderer/src/terminalClipboard'

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

function setup(
  opts: {
    selection?: string
    clip?: Partial<NonNullable<Clip>>
    clipOpts?: Parameters<typeof attachClipboard>[3]
  } = {}
): Setup {
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
  const dispose = attachClipboard(term, el, clipboard, opts.clipOpts)
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

describe('image paste', () => {
  const paste = (t: Setup): void => void t.key({ ...CS, code: 'KeyV' })

  it('pastes the uploaded path plus a space and never reads text', async () => {
    const pasteImage = vi.fn(async () => '/home/u/.cache/regit/paste/a.png')
    const t = setup({ clipOpts: { pasteImage } })
    paste(t)
    await flush()
    expect(t.term.paste).toHaveBeenCalledWith('/home/u/.cache/regit/paste/a.png ')
    expect(t.clipboard.readText).not.toHaveBeenCalled()
  })

  it('falls back to text paste when there is no image', async () => {
    const t = setup({ clipOpts: { pasteImage: async () => null } })
    paste(t)
    await flush()
    expect(t.term.paste).toHaveBeenCalledWith('clip')
  })

  it('reports a rejection and pastes nothing', async () => {
    const onError = vi.fn()
    const t = setup({
      clipOpts: {
        pasteImage: async () => {
          throw new Error('boom')
        },
        onError
      }
    })
    paste(t)
    await flush()
    expect(onError).toHaveBeenCalledWith('boom')
    expect(t.term.paste).not.toHaveBeenCalled()
    expect(t.clipboard.readText).not.toHaveBeenCalled()
  })
})

describe('formatPath', () => {
  it('leaves plain paths raw and quotes the rest', () => {
    expect(formatPath('/home/u/.cache/a-b_1.png')).toBe('/home/u/.cache/a-b_1.png')
    expect(formatPath('/home/my user/a.png')).toBe("'/home/my user/a.png'")
    expect(formatPath("/h/it's.png")).toBe("'/h/it'\\''s.png'")
    expect(formatPath('/h/a;b$c.png')).toBe("'/h/a;b$c.png'")
  })
})

describe('attachImageDrop', () => {
  const file = (name: string, type: string, size = 3): File =>
    new File([new Uint8Array(size)], name, { type })
  const drop = (el: HTMLElement, files: File[]): Event => {
    const ev = new Event('drop', { cancelable: true, bubbles: true })
    Object.defineProperty(ev, 'dataTransfer', { value: { files } })
    el.dispatchEvent(ev)
    return ev
  }
  const make = (): {
    el: HTMLElement
    term: { paste: Mock }
    upload: Mock
    onError: Mock
    dispose: () => void
  } => {
    const el = document.createElement('div')
    const term = { paste: vi.fn() }
    const upload = vi.fn(
      async (_b: Uint8Array, ext: string) => `/r/${ext === 'png' ? 'a b' : 'c'}.${ext}`
    )
    const onError = vi.fn()
    return { el, term, upload, onError, dispose: attachImageDrop(el, term, upload, onError) }
  }
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await flush()
  }

  it('uploads images and pastes all paths once', async () => {
    const t = make()
    const ev = drop(t.el, [file('a.png', 'image/png'), file('b.jpg', 'image/jpeg')])
    expect(ev.defaultPrevented).toBe(true)
    await settle()
    expect(t.upload).toHaveBeenCalledTimes(2)
    expect(t.upload.mock.calls[1][1]).toBe('jpg')
    expect(t.term.paste).toHaveBeenCalledTimes(1)
    expect(t.term.paste).toHaveBeenCalledWith("'/r/a b.png' /r/c.jpg ")
  })

  it('skips non-image and oversize files and reports them', async () => {
    const t = make()
    drop(t.el, [file('x.txt', 'text/plain'), file('big.png', 'image/png', 10 * 1024 * 1024 + 1)])
    await settle()
    expect(t.upload).not.toHaveBeenCalled()
    expect(t.onError).toHaveBeenCalledTimes(2)
    expect(t.term.paste).not.toHaveBeenCalled()
  })

  it('prevents default on dragover and removes listeners on dispose', () => {
    const t = make()
    const over = new Event('dragover', { cancelable: true })
    t.el.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    t.dispose()
    const over2 = new Event('dragover', { cancelable: true })
    t.el.dispatchEvent(over2)
    expect(over2.defaultPrevented).toBe(false)
    expect(drop(t.el, [file('a.png', 'image/png')]).defaultPrevented).toBe(false)
  })
})

describe('onBusy wiring', () => {
  it('clipboard paste begins and ends around pasteImage, also on rejection', async () => {
    for (const fail of [false, true]) {
      const end = vi.fn()
      const onBusy = vi.fn(() => end)
      const t = setup({
        clipOpts: {
          pasteImage: async () => {
            if (fail) throw new Error('x')
            return null
          },
          onError: () => {},
          onBusy
        }
      })
      t.key({ ...CS, code: 'KeyV' })
      expect(onBusy).toHaveBeenCalledTimes(1)
      await flush()
      expect(end).toHaveBeenCalledTimes(1)
    }
  })

  it('drop begins once per drop and ends after uploads settle', async () => {
    const el = document.createElement('div')
    const end = vi.fn()
    const onBusy = vi.fn(() => end)
    const upload = vi.fn(async () => {
      throw new Error('nope')
    })
    attachImageDrop(el, { paste: vi.fn() }, upload, () => {}, onBusy)
    const ev = new Event('drop', { cancelable: true })
    Object.defineProperty(ev, 'dataTransfer', {
      value: { files: [new File([new Uint8Array(2)], 'a.png', { type: 'image/png' })] }
    })
    el.dispatchEvent(ev)
    expect(onBusy).toHaveBeenCalledTimes(1)
    expect(end).not.toHaveBeenCalled()
    for (let i = 0; i < 5; i++) await flush()
    expect(end).toHaveBeenCalledTimes(1)
  })
})
