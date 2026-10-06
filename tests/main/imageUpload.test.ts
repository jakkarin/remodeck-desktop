import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  utimesSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalTarget, type SandboxTarget } from '../../src/main/sandbox/target'
import { MAX_IMAGE_BYTES, uploadImage } from '../../src/main/terminal/imageUpload'

describe('uploadImage', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'remodeck-img-')).replaceAll('\\', '/')
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('round-trips every byte value into ~/.cache/remodeck/paste with the given ext', async () => {
    const bytes = new Uint8Array(1024)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
    const remote = await uploadImage(new LocalTarget(home), bytes, 'webp')
    // Git Bash on Windows maps C:/... to /c/... or /tmp/...: compare the part under $HOME and read via the local path.
    const rel = remote.slice(remote.indexOf('/.cache/'))
    expect(rel).toMatch(/^[/][.]cache[/]remodeck[/]paste[/][0-9a-f-]{36}[.]webp$/)
    const p = home + rel
    expect(p.endsWith('.webp')).toBe(true)
    expect(Uint8Array.from(readFileSync(p))).toEqual(bytes)
  })

  it('removes files older than a day but keeps fresh ones', async () => {
    const dir = `${home}/.cache/remodeck/paste`
    mkdirSync(dir, { recursive: true })
    const old = `${dir}/old.png`
    const fresh = `${dir}/fresh.png`
    writeFileSync(old, 'x')
    writeFileSync(fresh, 'x')
    const t = new Date(Date.now() - 2 * 86400_000)
    utimesSync(old, t, t)
    await uploadImage(new LocalTarget(home), new Uint8Array([1, 2, 3]), 'png')
    expect(existsSync(old)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })

  it('rejects empty and oversize input without running exec', async () => {
    const exec = vi.fn()
    const target = { exec, gitUrl: () => '' } as unknown as SandboxTarget
    await expect(uploadImage(target, new Uint8Array(0), 'png')).rejects.toThrow()
    await expect(uploadImage(target, new Uint8Array(MAX_IMAGE_BYTES + 1), 'png')).rejects.toThrow()
    expect(exec).not.toHaveBeenCalled()
  })

  it('throws with stderr on a non-zero exit', async () => {
    const target = {
      exec: async () => ({ code: 1, stdout: '', stderr: 'disk full\n' }),
      gitUrl: () => ''
    } as unknown as SandboxTarget
    await expect(uploadImage(target, new Uint8Array([1]), 'png')).rejects.toThrow('disk full')
  })
})
