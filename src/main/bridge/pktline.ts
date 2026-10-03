import type { RefUpdate } from '../../shared/types'

export const ZERO_SHA = '0'.repeat(40)

const HEX4 = /^[0-9a-fA-F]{1,4}$/
const SHALLOW = /^shallow ([0-9a-f]{40}|[0-9a-f]{64})$/
const utf8 = new TextDecoder('utf-8', { fatal: true })
const COMMAND = /^([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) (\S+)$/

/**
 * Parse the command section of a git receive-pack request body.
 * Returns null while more bytes are needed; throws on anything it cannot
 * understand (the caller must then refuse to forward the push).
 */
export function parseReceivePackCommands(
  buf: Buffer
): { commands: RefUpdate[]; headerLength: number } | null {
  const commands: RefUpdate[] = []
  let pos = 0
  let idLen = 0
  for (;;) {
    const avail = Math.min(4, buf.length - pos)
    const prefix = buf.toString('latin1', pos, pos + avail)
    // Reject bad prefixes as soon as we see them, even if incomplete.
    if (avail > 0 && !HEX4.test(prefix)) throw new Error('pkt-line: invalid length prefix')
    if (avail < 4) return null
    const len = parseInt(prefix, 16)
    if (len === 0) return { commands, headerLength: pos + 4 }
    if (len < 4) throw new Error('pkt-line: invalid packet length')
    if (buf.length < pos + len) return null

    let line: string
    try {
      line = utf8.decode(buf.subarray(pos + 4, pos + len))
    } catch {
      throw new Error('pkt-line: payload is not valid UTF-8')
    }
    pos += len
    if (line.startsWith('push-cert')) throw new Error('pkt-line: push certificates are not supported')
    const nul = line.indexOf('\0')
    if (nul !== -1) line = line.slice(0, nul)
    if (line.endsWith('\n')) line = line.slice(0, -1)
    // Shallow lines (sent by shallow clones) precede the commands and update no refs.
    if (commands.length === 0 && SHALLOW.test(line)) continue
    const m = COMMAND.exec(line)
    if (!m || m[1].length !== m[2].length || (idLen !== 0 && m[1].length !== idLen)) throw new Error('pkt-line: malformed command line')
    idLen = m[1].length
    commands.push({ oldSha: m[1], newSha: m[2], ref: m[3] })
  }
}
