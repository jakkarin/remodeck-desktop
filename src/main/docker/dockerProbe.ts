import type { DockerCapability } from '../../shared/types'

/** Plain-bash script: prints `probe=missing`, or `probe-exit=<n>` + docker output + `dialstdio=<1|0>`. */
export const DOCKER_PROBE_SCRIPT = `command -v docker >/dev/null 2>&1 || { echo "probe=missing"; exit 0; }
out=$(docker version --format '{{json .}}' 2>&1); echo "probe-exit=$?"; printf '%s\n' "$out"
docker system dial-stdio --help >/dev/null 2>&1 && echo "dialstdio=1" || echo "dialstdio=0"
`

const MISSING = 'ไม่พบ docker บนเครื่องนี้'
const NO_PERMISSION =
  'user นี้ไม่มีสิทธิ์ใช้ docker — รัน sudo usermod -aG docker $USER แล้ว disconnect / connect ใหม่'
const NO_DAEMON = 'docker daemon ไม่ทำงาน — เช่น sudo systemctl start docker'
const TOO_OLD = 'docker บนเครื่องนี้เก่าเกินไป (ต้อง 18.09 ขึ้นไป)'

export function parseDockerProbe(stdout: string): DockerCapability {
  const lines = stdout.split(/\r?\n/)
  if (lines.some((l) => l.trim() === 'probe=missing')) return { state: 'missing', detail: MISSING }

  const exitIdx = lines.findIndex((l) => l.startsWith('probe-exit='))
  const dialIdx = lines.findIndex((l) => l.startsWith('dialstdio='))
  const exitCode = exitIdx >= 0 ? lines[exitIdx].slice(11).trim() : '1'
  const body = lines.slice(exitIdx + 1, dialIdx >= 0 ? dialIdx : undefined)
  const dockerOutput = body.join('\n').trim()

  if (exitCode !== '0') {
    if (/permission denied/i.test(dockerOutput)) return { state: 'no-permission', detail: NO_PERMISSION }
    return { state: 'no-daemon', detail: dockerOutput ? `${NO_DAEMON}\n${dockerOutput}` : NO_DAEMON }
  }
  if (dialIdx >= 0 && lines[dialIdx].slice(10).trim() === '0') return { state: 'too-old', detail: TOO_OLD }

  const json = body.map((l) => l.trim()).find((l) => l.startsWith('{'))
  try {
    const server = json ? (JSON.parse(json) as { Server?: { Version?: string; ApiVersion?: string } }).Server : undefined
    if (server?.Version && server.ApiVersion) {
      return { state: 'ok', version: server.Version, apiVersion: server.ApiVersion }
    }
  } catch {
    // fall through
  }
  return { state: 'no-daemon', detail: NO_DAEMON }
}
