import { describe, expect, it, vi } from 'vitest'
import { pickFolder, type ShowFolderDialog } from '../../../src/main/dialogs/pickFolder'
import { linuxPlatform, windowsPlatform } from '../../../src/main/platform/localPlatform'

const shown = (filePaths: string[], canceled = false): ReturnType<typeof vi.fn<ShowFolderDialog>> =>
  vi.fn<ShowFolderDialog>(async () => ({ canceled, filePaths }))

describe('pickFolder on Windows', () => {
  it('returns the chosen folder as a normalised local path', async () => {
    const show = shown(['d:\\develop\\app'])
    expect(await pickFolder(show, undefined, 'C:/Users/x', windowsPlatform)).toBe('D:/develop/app')
  })

  it('returns null when the dialog is cancelled', async () => {
    expect(await pickFolder(shown([], true), undefined, 'C:/Users/x', windowsPlatform)).toBeNull()
  })

  it('opens at the typed folder with ~ expanded, as a Windows path', async () => {
    const show = shown([], true)
    await pickFolder(show, '~/repos', 'C:\\Users\\x', windowsPlatform)
    expect(show).toHaveBeenCalledWith({ defaultPath: 'C:\\Users\\x\\repos' })
  })

  it('ignores a start folder that is not a string or not a local path', async () => {
    const show = shown([], true)
    await pickFolder(show, 42, 'C:/Users/x', windowsPlatform)
    await pickFolder(show, '/srv/app', 'C:/Users/x', windowsPlatform)
    await pickFolder(show, '', 'C:/Users/x', windowsPlatform)
    expect(show.mock.calls.map((c) => c[0])).toEqual([{}, {}, {}])
  })
})

describe('pickFolder on Linux', () => {
  it('opens at POSIX paths and keeps their slashes', async () => {
    const show = shown(['/home/me/app/'])
    expect(await pickFolder(show, '~/repos', '/home/me', linuxPlatform)).toBe('/home/me/app')
    await pickFolder(show, '/srv/app', '/home/me', linuxPlatform)
    expect(show.mock.calls.map((c) => c[0])).toEqual([
      { defaultPath: '/home/me/repos' },
      { defaultPath: '/srv/app' }
    ])
  })
})
