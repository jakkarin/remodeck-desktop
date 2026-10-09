import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SecretStore, type Encryptor } from '../../../src/main/gitAccess/secretStore'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remodeck-secrets-'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const enc: Encryptor = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(plain, 'utf8').reverse(),
  decrypt: (blob) => Buffer.from(blob).reverse().toString('utf8')
}

describe('SecretStore', () => {
  it('round-trips a secret without storing it in plaintext', () => {
    new SecretStore(dir, enc).set('t1', 'secret')
    expect(new SecretStore(dir, enc).get('t1')).toBe('secret')
    const file = path.join(dir, 'secrets.json')
    expect(fs.readFileSync(file, 'utf8')).not.toContain('secret')
    expect(fs.existsSync(`${file}.tmp`)).toBe(false)
  })

  it('deletes a secret', () => {
    const s = new SecretStore(dir, enc)
    s.set('t1', 'secret')
    s.delete('t1')
    expect(() => s.get('t1')).toThrow(/No secret/)
    expect(() => s.delete('missing')).not.toThrow()
  })

  it('refuses to save when encryption is unavailable', () => {
    const s = new SecretStore(dir, { ...enc, isAvailable: () => false })
    expect(() => s.set('t', 'x')).toThrow(/encryption isn't available/i)
    expect(fs.existsSync(path.join(dir, 'secrets.json'))).toBe(false)
  })
})
