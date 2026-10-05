import fs from 'node:fs'

const WINDOWS_SSH = 'C:/Windows/System32/OpenSSH/ssh.exe'

export function resolveSshPath(): string {
  return fs.existsSync(WINDOWS_SSH) ? WINDOWS_SSH : 'ssh'
}
