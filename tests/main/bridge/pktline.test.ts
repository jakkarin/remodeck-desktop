import { describe, expect, it } from 'vitest'
import {
  parseReceivePackCommands,
  ReportStatusParser,
  ZERO_SHA
} from '../../../src/main/bridge/pktline'
import { evaluateRules } from '../../../src/main/bridge/rules'

describe('ReportStatusParser', () => {
  const p = (s: string | Buffer): Buffer => {
    const b = typeof s === 'string' ? Buffer.from(s) : s
    return Buffer.concat([Buffer.from((b.length + 4).toString(16).padStart(4, '0')), b])
  }
  const band = (n: number, data: Buffer): Buffer => p(Buffer.concat([Buffer.from([n]), data]))
  const feed = (buf: Buffer, step = buf.length): ReportStatusParser => {
    const r = new ReportStatusParser()
    for (let i = 0; i < buf.length; i += step) r.push(buf.subarray(i, i + step))
    return r
  }

  it('plain report-status: ok', () => {
    const buf = Buffer.concat([p('unpack ok\n'), p('ok refs/heads/a\n'), Buffer.from('0000')])
    expect(feed(buf).result()).toEqual({ unpack: 'ok', ok: ['refs/heads/a'], ng: [], fatal: null })
  })

  it('side-band report-status with progress and an ng, fed byte by byte', () => {
    const inner = Buffer.concat([
      p('unpack ok\n'),
      p('ok refs/heads/a\n'),
      p('ng refs/heads/b non-fast-forward\n'),
      Buffer.from('0000')
    ])
    const buf = Buffer.concat([
      band(2, Buffer.from('remote: progress\n')),
      band(1, inner.subarray(0, 7)),
      band(1, inner.subarray(7)),
      Buffer.from('0000')
    ])
    expect(feed(buf, 1).result()).toEqual({
      unpack: 'ok',
      ok: ['refs/heads/a'],
      ng: [{ ref: 'refs/heads/b', reason: 'non-fast-forward' }],
      fatal: null
    })
  })

  it('records unpack errors and band-3 fatal messages', () => {
    const inner = Buffer.concat([p('unpack index-pack abnormal exit\n'), Buffer.from('0000')])
    const buf = Buffer.concat([band(1, inner), band(3, Buffer.from('boom\n'))])
    expect(feed(buf).result()).toEqual({
      unpack: 'index-pack abnormal exit',
      ok: [],
      ng: [],
      fatal: 'boom'
    })
  })

  it('empty response yields no unpack status', () => {
    expect(new ReportStatusParser().result()).toEqual({ unpack: null, ok: [], ng: [], fatal: null })
  })
})

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
    expect(() =>
      parseReceivePackCommands(Buffer.from(pkt(`${A} ${'b'.repeat(64)} refs/heads/x\n`) + '0000'))
    ).toThrow()
  })

  it('throws instead of waiting when a bad prefix follows incomplete data', () => {
    expect(() => parseReceivePackCommands(Buffer.from('00zz'))).toThrow()
  })

  const rawPkt = (bytes: Buffer): Buffer =>
    Buffer.concat([Buffer.from((bytes.length + 4).toString(16).padStart(4, '0')), bytes])

  it('decodes non-ASCII refs as UTF-8 so protected Thai branches are blocked', () => {
    const header = Buffer.concat([
      rawPkt(Buffer.from(`${A} ${B} refs/heads/ทดสอบ\0report-status\n`, 'utf8')),
      Buffer.from('0000')
    ])
    const r = parseReceivePackCommands(header)
    expect(r?.commands[0].ref).toBe('refs/heads/ทดสอบ')
    expect(
      evaluateRules(r!.commands, { enforceRules: true, protectedBranches: ['ทดสอบ'] })
    ).toEqual({
      allowed: false,
      reason: 'branch ทดสอบ is protected'
    })
  })

  it('throws on invalid UTF-8 payloads', () => {
    const bytes = Buffer.concat([
      Buffer.from(`${A} ${B} refs/heads/`),
      Buffer.from([0xff, 0xfe]),
      Buffer.from('\n')
    ])
    expect(() =>
      parseReceivePackCommands(Buffer.concat([rawPkt(bytes), Buffer.from('0000')]))
    ).toThrow()
  })

  it('skips shallow lines before the first command only', () => {
    const ok =
      pkt(`shallow ${A}\n`) +
      pkt(`shallow ${'b'.repeat(40)}\n`) +
      pkt(`${A} ${B} refs/heads/x\0caps\n`) +
      '0000'
    expect(parseReceivePackCommands(Buffer.from(ok))?.commands).toEqual([
      { oldSha: A, newSha: B, ref: 'refs/heads/x' }
    ])
    const bad = pkt(`${A} ${B} refs/heads/x\0caps\n`) + pkt(`shallow ${A}\n`) + '0000'
    expect(() => parseReceivePackCommands(Buffer.from(bad))).toThrow()
    expect(() => parseReceivePackCommands(Buffer.from(pkt('shallow nothex\n') + '0000'))).toThrow()
  })

  it('requires one id length across all commands', () => {
    const header =
      pkt(`${A} ${B} refs/heads/a\0c\n`) +
      pkt(`${'a'.repeat(64)} ${'b'.repeat(64)} refs/heads/b\n`) +
      '0000'
    expect(() => parseReceivePackCommands(Buffer.from(header))).toThrow()
  })

  it('stops at the first flush and does not parse a push-options section', () => {
    const header = pkt(`${A} ${B} refs/heads/a\0push-options\n`) + '0000'
    const buf = Buffer.concat([Buffer.from(header), Buffer.from(pkt('opt=1') + '0000PACK')])
    const r = parseReceivePackCommands(buf)
    expect(r?.commands).toHaveLength(1)
    expect(r?.headerLength).toBe(Buffer.byteLength(header))
  })
})
