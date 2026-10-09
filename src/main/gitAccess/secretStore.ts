import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'

export interface Encryptor {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(blob: Buffer): string
}

/** Wraps Electron safeStorage; touched only inside the call so node tests can import this module. */
export function electronEncryptor(): Encryptor {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (blob) => safeStorage.decryptString(blob)
  }
}

/** Token secrets keyed by token id, encrypted at rest in `secrets.json` (base64 of the cipher blob). */
export class SecretStore {
  constructor(
    private readonly dir: string,
    private readonly enc: Encryptor
  ) {}

  set(id: string, secret: string): void {
    if (!this.enc.isAvailable())
      throw new Error("Encryption isn't available on this system, so the token can't be saved")
    const all = this.read()
    all[id] = this.enc.encrypt(secret).toString('base64')
    this.write(all)
  }

  get(id: string): string {
    const b64 = this.read()[id]
    if (b64 === undefined) throw new Error(`No secret stored for token ${id}`)
    return this.enc.decrypt(Buffer.from(b64, 'base64'))
  }

  delete(id: string): void {
    const all = this.read()
    if (!(id in all)) return
    delete all[id]
    this.write(all)
  }

  private get file(): string {
    return path.join(this.dir, 'secrets.json')
  }

  private read(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, string>
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
  }

  private write(all: Record<string, string>): void {
    fs.mkdirSync(this.dir, { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2))
    fs.renameSync(tmp, this.file)
  }
}
