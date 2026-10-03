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

/** Incremental pkt-line splitter: emits payloads, stops at the first flush or on garbage. */
class PktReader {
  private buf: Buffer = Buffer.alloc(0)
  done = false

  constructor(private readonly onPayload: (payload: Buffer) => void) {}

  push(chunk: Buffer): void {
    if (this.done) return
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])
    while (!this.done && this.buf.length >= 4) {
      const prefix = this.buf.toString('latin1', 0, 4)
      if (!/^[0-9a-fA-F]{4}$/.test(prefix)) {
        this.done = true
        break
      }
      const len = parseInt(prefix, 16)
      if (len === 0) {
        this.done = true
        break
      }
      if (len < 4) {
        // delim (0001) / response-end (0002) packets carry no payload
        this.buf = this.buf.subarray(4)
        continue
      }
      if (this.buf.length < len) break
      const payload = this.buf.subarray(4, len)
      this.buf = this.buf.subarray(len)
      this.onPayload(payload)
    }
    if (this.done) this.buf = Buffer.alloc(0)
  }
}

export type ReportStatus = {
  /** `ok` or the unpack error; null when no report-status was seen. */
  unpack: string | null
  ok: string[]
  ng: { ref: string; reason: string }[]
  /** side-band channel 3 (fatal error) message, if any. */
  fatal: string | null
}

/**
 * Reads the receive-pack report-status from a git-receive-pack response, with or without
 * side-band (band 1 = report-status pkt-lines, band 2 = progress, band 3 = fatal error).
 * It only observes the bytes; the caller forwards them unchanged.
 */
export class ReportStatusParser {
  private readonly status: ReportStatus = { unpack: null, ok: [], ng: [], fatal: null }
  private mode: 'unknown' | 'plain' | 'sideband' = 'unknown'
  private readonly inner = new PktReader((p) => this.line(p))
  private readonly outer = new PktReader((p) => {
    if (this.mode === 'unknown') this.mode = p.length > 0 && p[0] >= 1 && p[0] <= 3 ? 'sideband' : 'plain'
    if (this.mode === 'plain') return this.line(p)
    const band = p[0]
    if (band === 1) this.inner.push(p.subarray(1))
    else if (band === 3) this.status.fatal = p.toString('utf8', 1).trim()
  })

  push(chunk: Buffer): void {
    this.outer.push(chunk)
  }

  result(): ReportStatus {
    return { ...this.status, ok: [...this.status.ok], ng: [...this.status.ng] }
  }

  private line(payload: Buffer): void {
    const text = payload.toString('utf8').replace(/\n$/, '')
    if (text.startsWith('unpack ')) {
      this.status.unpack = text.slice('unpack '.length)
    } else if (text.startsWith('ok ')) {
      this.status.ok.push(text.slice(3))
    } else if (text.startsWith('ng ')) {
      const rest = text.slice(3)
      const sp = rest.indexOf(' ')
      this.status.ng.push(
        sp < 0 ? { ref: rest, reason: '' } : { ref: rest.slice(0, sp), reason: rest.slice(sp + 1) }
      )
    }
  }
}
