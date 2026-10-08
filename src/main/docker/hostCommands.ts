import { shQuote, shPath, validateSandboxPath } from '../sandbox/shell'
import {
  CONTAINER_ID,
  COMPOSE_ACTIONS,
  COMPOSE_PROJECT,
  type ComposeAction
} from '../../shared/containers'

function checkId(id: string): void {
  if (!CONTAINER_ID.test(id)) throw new Error('container id ไม่ถูกต้อง')
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
  action: ComposeAction
): string {
  if (!COMPOSE_PROJECT.test(p.name)) throw new Error('ชื่อ compose project ไม่ถูกต้อง')
  if (!COMPOSE_ACTIONS.includes(action)) throw new Error('compose action ไม่ถูกต้อง')
  const parts = ['docker compose', '-p', shQuote(p.name)]
  if (p.workingDir) {
    validateSandboxPath(p.workingDir)
    parts.push('--project-directory', shPath(p.workingDir))
  }
  for (const f of p.configFiles) {
    validateSandboxPath(f)
    parts.push('-f', shPath(f))
  }
  parts.push(action === 'up' ? 'up -d' : action)
  return parts.join(' ')
}

export function buildHostSshArgs(sshHost: string, remoteCmd: string): string[] {
  return ['-t', sshHost, remoteCmd]
}
