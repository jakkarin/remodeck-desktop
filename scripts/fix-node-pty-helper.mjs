import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// node-pty's macOS prebuilds ship spawn-helper without the execute bit, so every terminal spawn
// fails with "posix_spawnp failed". Restore it after install; packaging keeps the mode.
if (process.platform !== 'win32') {
  const require = createRequire(import.meta.url)
  const prebuilds = join(dirname(require.resolve('node-pty/package.json')), 'prebuilds')
  if (existsSync(prebuilds)) {
    for (const platform of readdirSync(prebuilds)) {
      const helper = join(prebuilds, platform, 'spawn-helper')
      if (existsSync(helper)) chmodSync(helper, 0o755)
    }
  }
}
