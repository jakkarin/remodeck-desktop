import { afterEach, describe, expect, it } from 'vitest'
import type { Duplex } from 'node:stream'
import { localDialArgs, spawnDuplex, sshDialArgs } from '../../../src/main/docker/dialStdio'

let duplex: Duplex | undefined
afterEach(() => {
  duplex?.destroy()
  duplex = undefined
})

describe('sshDialArgs', () => {
  it('pins the keepalive options and the dial-stdio command', () => {
    expect(sshDialArgs('box')).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=3',
      'box',
      'docker',
      'system',
      'dial-stdio'
    ])
  })
})

describe('spawnDuplex', () => {
  it('round-trips bytes through the child', async () => {
    duplex = spawnDuplex(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'])
    const got = new Promise<string>((resolve) =>
      duplex!.once('data', (d: Buffer) => resolve(d.toString()))
    )
    duplex.write('hello')
    expect(await got).toBe('hello')
  })

  it('destroy() kills the child', async () => {
    duplex = spawnDuplex(process.execPath, ['-e', 'setInterval(()=>{},1000)'])
    const child = (duplex as Duplex & { child: import('node:child_process').ChildProcess }).child
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    duplex.destroy()
    await exited
  })

  it('destroys with stderr text when the child exits early', async () => {
    duplex = spawnDuplex(process.execPath, ['-e', "console.error('boom'); process.exit(1)"])
    duplex.resume()
    const err = await new Promise<Error>((resolve) => duplex!.once('error', resolve))
    expect(err.message).toBe('boom')
  })
})

describe('localDialArgs', () => {
  it('localDialArgs is docker system dial-stdio', () => {
    expect(localDialArgs()).toEqual(['system', 'dial-stdio'])
  })
})
