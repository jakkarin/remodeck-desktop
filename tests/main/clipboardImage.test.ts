import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../../src/main/app'
import { TerminalService } from '../../src/main/terminal/terminalService'

const { readClipboard, decodeImage } = vi.hoisted(() => ({
  readClipboard: vi.fn(),
  decodeImage: vi.fn()
}))

vi.mock('electron', () => ({
  clipboard: { read: readClipboard },
  nativeImage: { createFromBuffer: decodeImage },
  Notification: class {
    static isSupported(): boolean {
      return false
    }
  },
  safeStorage: {},
  dialog: {},
  shell: {}
}))

describe('terminal clipboard images with Electron 44', () => {
  let app: Awaited<ReturnType<typeof createApp>>
  let dataDir: string
  let upload: ReturnType<typeof vi.spyOn<TerminalService, 'uploadImage'>>
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'remodeck-clipboard-'))
    app = await createApp({ dataDir, window: () => null })
  })
  afterAll(async () => {
    await app?.dispose()
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  })
  beforeEach(() => {
    readClipboard.mockReset()
    decodeImage.mockReset().mockReturnValue({ isEmpty: () => false, toPNG: () => png })
    upload = vi.spyOn(TerminalService.prototype, 'uploadImage').mockResolvedValue('/tmp/paste.png')
  })
  afterEach(() => vi.restoreAllMocks())

  it('awaits clipboard items and uploads PNG bytes from an image after a text item', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const getType = vi.fn(async () => new Blob([bytes], { type: 'image/png' }))
    readClipboard.mockResolvedValue([{ types: ['text/plain'] }, { types: ['image/png'], getType }])

    await expect(app.api.terminal.pasteImage('tab')).resolves.toBe('/tmp/paste.png')
    expect(getType).toHaveBeenCalledWith('image/png')
    expect(decodeImage).toHaveBeenCalledWith(Buffer.from(bytes))
    expect(upload).toHaveBeenCalledWith('tab', new Uint8Array(png), 'png')
  })

  it('prefers a PNG representation when the item also offers JPEG', async () => {
    const getType = vi.fn(async () => new Blob([png], { type: 'image/png' }))
    readClipboard.mockResolvedValue([{ types: ['image/jpeg', 'image/png'], getType }])

    await app.api.terminal.pasteImage('tab')
    expect(getType).toHaveBeenCalledExactlyOnceWith('image/png')
  })

  it('converts a JPEG-only clipboard item to PNG before uploading', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff])
    const getType = vi.fn(async () => new Blob([jpeg], { type: 'image/jpeg' }))
    readClipboard.mockResolvedValue([{ types: ['image/jpeg'], getType }])

    await app.api.terminal.pasteImage('tab')
    expect(getType).toHaveBeenCalledWith('image/jpeg')
    expect(decodeImage).toHaveBeenCalledWith(Buffer.from(jpeg))
    expect(upload).toHaveBeenCalledWith('tab', new Uint8Array(png), 'png')
  })

  it('returns null without an upload when the clipboard contains no images', async () => {
    readClipboard.mockResolvedValue([{ types: ['text/plain'] }])

    await expect(app.api.terminal.pasteImage('tab')).resolves.toBeNull()
    expect(decodeImage).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it('returns null when the image cannot be decoded', async () => {
    readClipboard.mockResolvedValue([
      { types: ['image/png'], getType: async () => new Blob(['invalid image']) }
    ])
    decodeImage.mockReturnValue({ isEmpty: () => true })

    await expect(app.api.terminal.pasteImage('tab')).resolves.toBeNull()
    expect(upload).not.toHaveBeenCalled()
  })

  it('propagates clipboard read errors without uploading', async () => {
    readClipboard.mockRejectedValue(new Error('clipboard unavailable'))

    await expect(app.api.terminal.pasteImage('tab')).rejects.toThrow('clipboard unavailable')
    expect(upload).not.toHaveBeenCalled()
  })
})
