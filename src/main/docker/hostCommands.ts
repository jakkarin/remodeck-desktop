import type { LocalPlatform } from '../platform/localPlatform'
import { shQuote, shPath, validateSandboxPath } from '../sandbox/shell'
import {
  CONTAINER_ID,
  COMPOSE_ACTIONS,
  COMPOSE_PROJECT,
  type ComposeAction
} from '../../shared/containers'

function checkId(id: string): void {
  if (!CONTAINER_ID.test(id)) throw new Error('Invalid container id')
}

export function logsCommand(id: string): string {
  checkId(id)
  return `docker logs -f --tail 500 ${shQuote(id)}`
}

export function shellCommand(id: string): string {
  checkId(id)
  return `docker exec -it ${shQuote(id)} sh -c 'command -v bash >/dev/null && exec bash || exec sh'`
}

export function composeCommand(
  p: { name: string; workingDir: string; configFiles: string[] },
  action: ComposeAction,
  opts?: { local?: LocalPlatform }
): string {
  const local = opts?.local
  // Docker Desktop labels on Windows hold Windows paths (D:\proj); Git Bash takes them as D:/proj.
  const dir = (p: string): string => {
    validateSandboxPath(p, local)
    return shPath(local ? local.normalizePath(p) : p)
  }
  if (!COMPOSE_PROJECT.test(p.name)) throw new Error('Invalid compose project name')
  if (!COMPOSE_ACTIONS.includes(action)) throw new Error('Invalid compose action')
  if (action !== 'down' && !p.workingDir && p.configFiles.length === 0)
    throw new Error(`Cannot run ${action}: the compose project path is unknown`)
  const parts = ['docker compose', '-p', shQuote(p.name)]
  if (p.workingDir) {
    parts.push('--project-directory', dir(p.workingDir))
  }
  for (const f of p.configFiles) {
    parts.push('-f', dir(f))
  }
  parts.push(action === 'up' ? 'up -d' : action)
  return parts.join(' ')
}

export function buildHostSshArgs(sshHost: string, remoteCmd: string): string[] {
  return ['-t', sshHost, remoteCmd]
}
