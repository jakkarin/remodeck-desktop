import { describe, expect, it } from 'vitest'
import { parseReceivePackCommands, ZERO_SHA } from '../../../src/main/bridge/pktline'

const pkt = (s: string): string => (s.length + 4).toString(16).padStart(4, '0') + s
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const C = 'c'.repeat(40)

describe('parseReceivePackCommands', () => {
  it('parses two commands, strips capabilities, ignores trailing pack', () => {
    const header =
      pkt(`${A} ${B} refs/heads/main\0 report-status side-band-64k agent=git/2\n`) +
      pkt(`${ZERO_SHA} ${C} refs/heads/feat\n`) +
      '0000'
    const buf = Buffer.concat([Buffer.from(header), Buffer.from('PACK\x00\x00\x00\x02binary')])
    const r = parseReceivePackCommands(buf)
    expect(r).toEqual({
      commands: [
        { oldSha: A, newSha: B, ref: 'refs/heads/main' },
        { oldSha: ZERO_SHA, newSha: C, ref: 'refs/heads/feat' }
      ],
      headerLength: Buffer.byteLength(header)
    })
  })

  it('returns null when the header is incomplete', () => {
    const header = pkt(`${A} ${B} refs/heads/main\0report-status\n`) + '0000'
    for (const cut of [0, 2, 3, 4, 10, header.length - 4, header.length - 1]) {
      expect(parseReceivePackCommands(Buffer.from(header.slice(0, cut)))).toBeNull()
    }
  })

  it('handles a bare flush as no commands', () => {
    expect(parseReceivePackCommands(Buffer.from('0000'))).toEqual({ commands: [], headerLength: 4 })
  })

  it('parses SHA-256 ids and lines without trailing newline', () => {
    const o = 'a'.repeat(64)
    const n = 'b'.repeat(64)
    const header = pkt(`${o} ${n} refs/tags/v1`) + '0000'
    expect(parseReceivePackCommands(Buffer.from(header))?.commands).toEqual([
      { oldSha: o, newSha: n, ref: 'refs/tags/v1' }
    ])
  })

  it('throws on a push certificate', () => {
    const header = pkt('push-cert\0report-status\n') + pkt('certificate version 0.1\n') + '0000'
    expect(() => parseReceivePackCommands(Buffer.from(header))).toThrow()
  })

  it('throws on malformed packets', () => {
    expect(() => parseReceivePackCommands(Buffer.from('zzzz'))).toThrow()
    expect(() => parseReceivePackCommands(Buffer.from('0001'))).toThrow()
    expect(() => parseReceivePackCommands(Buffer.from('0003'))).toThrow()
    expect(() => parseReceivePackCommands(Buffer.from(pkt('hello world\n') + '0000'))).toThrow()
    expect(() => parseReceivePackCommands(Buffer.from(pkt(`${A} ${B} \n`) + '0000'))).toThrow()
    expect(() => parseReceivePackCommands(Buffer.from(pkt(`${A} ${'b'.repeat(64)} refs/heads/x\n`) + '0000'))).toThrow()
  })

  it('throws instead of waiting when a bad prefix follows incomplete data', () => {
    expect(() => parseReceivePackCommands(Buffer.from('00zz'))).toThrow()
  })
})
