import { describe, expect, it } from 'vitest'
import { DOCKER_PROBE_SCRIPT, parseDockerProbe } from '../../../src/main/docker/dockerProbe'

describe('parseDockerProbe', () => {
  it('missing', () =>
    expect(parseDockerProbe('probe=missing\n')).toEqual({
      state: 'missing',
      detail: 'ไม่พบ docker บนเครื่องนี้'
    }))
  it('no-permission', () => {
    const out =
      'probe-exit=1\n{"Client":{}}\npermission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock\ndialstdio=1\n'
    const r = parseDockerProbe(out)
    expect(r.state).toBe('no-permission')
    expect(r).toMatchObject({
      detail: 'user นี้ไม่มีสิทธิ์ใช้ docker — รัน sudo usermod -aG docker $USER แล้ว disconnect / connect ใหม่'
    })
  })
  it('no-daemon keeps the docker output', () => {
    const out =
      'probe-exit=1\nCannot connect to the Docker daemon at unix:///var/run/docker.sock\ndialstdio=1\n'
    expect(parseDockerProbe(out)).toEqual({
      state: 'no-daemon',
      detail:
        'docker daemon ไม่ทำงาน — เช่น sudo systemctl start docker\nCannot connect to the Docker daemon at unix:///var/run/docker.sock'
    })
  })
  it('too-old', () =>
    expect(
      parseDockerProbe(
        'probe-exit=0\n{"Server":{"Version":"18.06.0","ApiVersion":"1.38"}}\ndialstdio=0\n'
      )
    ).toEqual({ state: 'too-old', detail: 'docker บนเครื่องนี้เก่าเกินไป (ต้อง 18.09 ขึ้นไป)' }))
  it('ok', () =>
    expect(
      parseDockerProbe(
        'probe-exit=0\n{"Client":{},"Server":{"Version":"27.3.1","ApiVersion":"1.47"}}\ndialstdio=1\n'
      )
    ).toEqual({ state: 'ok', version: '27.3.1', apiVersion: '1.47' }))
  it('ok output without Server is no-daemon', () => {
    const r = parseDockerProbe('probe-exit=0\n{"Client":{}}\ndialstdio=1\n')
    expect(r).toEqual({ state: 'no-daemon', detail: 'docker daemon ไม่ทำงาน — เช่น sudo systemctl start docker' })
  })
  it('unparsable JSON is no-daemon; CRLF tolerated', () => {
    expect(parseDockerProbe('probe-exit=0\r\n{oops\r\ndialstdio=1\r\n').state).toBe('no-daemon')
    expect(
      parseDockerProbe('probe-exit=0\r\n{"Server":{"Version":"1","ApiVersion":"2"}}\r\ndialstdio=1\r\n').state
    ).toBe('ok')
  })
  it('script contains the probe markers', () => {
    expect(DOCKER_PROBE_SCRIPT).toContain('probe=missing')
    expect(DOCKER_PROBE_SCRIPT).toContain('dialstdio=')
  })
})
