import { spawn, type ChildProcess } from 'node:child_process'
import { Duplex } from 'node:stream'

/** Duplex over a child process: stdout is readable, stdin is writable. Destroying it kills the child. */
export function spawnDuplex(cmd: string, args: string[]): Duplex {
  const child: ChildProcess = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  let stderr = ''
  let gotOutput = false
  child.stderr!.on('data', (d: Buffer) => {
    if (stderr.length < 8192) stderr += d.toString()
  })

  const duplex = new Duplex({
    read() {
      child.stdout!.resume()
    },
    write(chunk, _enc, cb) {
      if (!child.stdin || child.stdin.destroyed) return cb(new Error('stdin closed'))
      child.stdin.write(chunk, (err) => cb(err ?? null))
    },
    final(cb) {
      child.stdin?.end()
      cb()
    },
    destroy(err, cb) {
      if (child.exitCode === null && child.signalCode === null) child.kill()
      cb(err)
    }
  })

  child.stdout!.on('data', (d: Buffer) => {
    gotOutput = true
    if (!duplex.push(d)) child.stdout!.pause()
  })
  child.stdout!.on('end', () => duplex.push(null))
  child.stdin!.on('error', () => {})
  child.on('error', (e) => duplex.destroy(e))
  child.on('close', (code) => {
    if (!gotOutput && !duplex.destroyed) {
      duplex.destroy(new Error(stderr.trim() || `exit ${code}`))
    }
  })

  Object.defineProperty(duplex, 'child', { value: child })
  return duplex
}

export function sshDialStdio(sshPath: string, sshHost: string): Duplex {
  return spawnDuplex(sshPath, [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    sshHost,
    'docker',
    'system',
    'dial-stdio'
  ])
}
