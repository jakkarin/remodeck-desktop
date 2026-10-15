import { describe, expect, it, vi } from 'vitest'
import { pickFolder, type ShowFolderDialog } from '../../../src/main/dialogs/pickFolder'

const shown = (filePaths: string[], canceled = false): ReturnType<typeof vi.fn<ShowFolderDialog>> =>
  vi.fn<ShowFolderDialog>(async () => ({ canceled, filePaths }))

describe('pickFolder', () => {
  it('returns the chosen folder as a normalised local path', async () => {
    const show = shown(['d:\\develop\\app'])
    expect(await pickFolder(show, undefined, 'C:/Users/x')).toBe('D:/develop/app')
  })

  it('returns null when the dialog is cancelled', async () => {
    expect(await pickFolder(shown([], true), undefined, 'C:/Users/x')).toBeNull()
  })

  it('opens at the typed folder with ~ expanded, as a Windows path', async () => {
    const show = shown([], true)
    await pickFolder(show, '~/repos', 'C:\\Users\\x')
    expect(show).toHaveBeenCalledWith({ defaultPath: 'C:\\Users\\x\\repos' })
  })

  it('ignores a start folder that is not a string or not a local path', async () => {
    const show = shown([], true)
    await pickFolder(show, 42, 'C:/Users/x')
    await pickFolder(show, '/srv/app', 'C:/Users/x')
    await pickFolder(show, '', 'C:/Users/x')
    expect(show.mock.calls.map((c) => c[0])).toEqual([{}, {}, {}])
  })
})
