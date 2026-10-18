import { randomInt } from 'node:crypto'
import { runProcess } from '../proc/run'

/** Plain-bash script: prints exactly `git=<version or empty>` and `remotehttp=<1|0>`. */
export const PREFLIGHT_SCRIPT = `v=$(git --version 2>/dev/null) || v=""
echo "git=$v"
if [ -n "$v" ] && [ -x "$(git --exec-path)/git-remote-http" ]; then echo "remotehttp=1"; else echo "remotehttp=0"; fi
`

export function parsePreflight(stdout: string): { gitVersion: string | null; remoteHttp: boolean } {
  let gitVersion: string | null = null
  let remoteHttp = false
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('git=')) gitVersion = line.slice(4).trim() || null
    else if (line.startsWith('remotehttp=')) remoteHttp = line.slice(11).trim() === '1'
  }
  return { gitVersion, remoteHttp }
}

/** True iff sshd allows remote forwarding (tries a throwaway -R on a random port). */
export async function checkRemoteForward(sshPath: string, sshHost: string): Promise<boolean> {
  const port = randomInt(20000, 60000)
  try {
    const r = await runProcess(
      sshPath,
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        '-o',
        'ExitOnForwardFailure=yes',
        '-R',
        `127.0.0.1:${port}:127.0.0.1:9`,
        sshHost,
        'true'
      ],
      { timeoutMs: 30000 }
    )
    return r.code === 0
  } catch {
    return false
  }
}
