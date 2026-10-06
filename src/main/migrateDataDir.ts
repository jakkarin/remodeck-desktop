import fs from 'node:fs'

/**
 * Carries data over from the app's previous name (regit → remodeck). Copies `from` to `to` only when
 * `to` does not exist yet; the copy lands in a temp dir first so a crash never leaves a half-filled `to`.
 * The old dir is kept. Returns true when a copy happened.
 */
export function migrateDataDir(from: string, to: string): boolean {
  if (fs.existsSync(to) || !fs.existsSync(from)) return false
  const tmp = `${to}.migrating`
  fs.rmSync(tmp, { recursive: true, force: true })
  fs.cpSync(from, tmp, { recursive: true })
  fs.renameSync(tmp, to)
  return true
}
