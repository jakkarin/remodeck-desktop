import type { DockerCapability } from '../../shared/types'

/** Plain-bash script: prints `probe=missing`, or `probe-exit=<n>` + docker output + `dialstdio=<1|0>`. */
export const DOCKER_PROBE_SCRIPT = `command -v docker >/dev/null 2>&1 || { echo "probe=missing"; exit 0; }
out=$(docker version --format '{{json .}}' 2>&1); echo "probe-exit=$?"; printf '%s\n' "$out"
docker system dial-stdio --help >/dev/null 2>&1 && echo "dialstdio=1" || echo "dialstdio=0"
`

const MISSING = 'Docker was not found on this host'
const NO_PERMISSION =
  'This user has no permission to use docker — run sudo usermod -aG docker $USER, then disconnect and connect again'
const NO_DAEMON = 'The docker daemon is not running — e.g. sudo systemctl start docker'
const TOO_OLD = 'Docker on this host is too old (18.09 or newer required)'

export function parseDockerProbe(stdout: string): DockerCapability {
  const lines = stdout.split(/\r?\n/)
  if (lines.some((l) => l.trim() === 'probe=missing')) return { state: 'missing', detail: MISSING }

  const exitIdx = lines.findIndex((l) => l.startsWith('probe-exit='))
  const dialIdx = lines.findIndex((l) => l.startsWith('dialstdio='))
  const exitCode = exitIdx >= 0 ? lines[exitIdx].slice(11).trim() : '1'
  const body = lines.slice(exitIdx + 1, dialIdx >= 0 ? dialIdx : undefined)
  const dockerOutput = body.join('\n').trim()

  if (exitCode !== '0') {
    if (/permission denied/i.test(dockerOutput))
      return { state: 'no-permission', detail: NO_PERMISSION }
    return {
      state: 'no-daemon',
      detail: dockerOutput ? `${NO_DAEMON}\n${dockerOutput}` : NO_DAEMON
    }
  }
  if (dialIdx >= 0 && lines[dialIdx].slice(10).trim() === '0')
    return { state: 'too-old', detail: TOO_OLD }

  const json = body.map((l) => l.trim()).find((l) => l.startsWith('{'))
  try {
    const server = json
      ? (JSON.parse(json) as { Server?: { Version?: string; ApiVersion?: string } }).Server
      : undefined
    if (server?.Version && server.ApiVersion) {
      return { state: 'ok', version: server.Version, apiVersion: server.ApiVersion }
    }
  } catch {
    // fall through
  }
  return { state: 'no-daemon', detail: NO_DAEMON }
}
