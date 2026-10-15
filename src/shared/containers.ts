// Shared between main and renderer: types and pure functions only, no node imports.
import type { ResourceKind } from './resources'

export type ContainerState =
  'created' | 'running' | 'paused' | 'restarting' | 'removing' | 'exited' | 'dead'

export type ContainerInfo = {
  id: string
  name: string
  image: string
  imageId: string
  state: ContainerState
  status: string
  created: number
  ports: string[]
  volumes: string[]
  networks: string[]
  compose: { project: string; service: string; workingDir: string; configFiles: string[] } | null
}

export type ContainerAction = 'start' | 'stop' | 'restart' | 'remove'

export type ContainerProject = {
  name: string
  workingDir: string
  configFiles: string[]
  containers: ContainerInfo[]
}

export const CONTAINER_ID = /^[a-f0-9]{12,64}$/

const STATES: readonly string[] = [
  'created',
  'running',
  'paused',
  'restarting',
  'removing',
  'exited',
  'dead'
]

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function formatPorts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Map<string, number>()
  for (const entry of raw) {
    const p = asRecord(entry)
    if (typeof p.PrivatePort !== 'number') continue
    const type = str(p.Type) || 'tcp'
    const text =
      typeof p.PublicPort === 'number'
        ? `${p.PublicPort}→${p.PrivatePort}/${type}`
        : `${p.PrivatePort}/${type}`
    seen.set(text, p.PrivatePort)
  }
  return [...seen.entries()]
    .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([text]) => text)
}

function volumeNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const names = new Set<string>()
  for (const entry of raw) {
    const m = asRecord(entry)
    if (m.Type === 'volume' && str(m.Name)) names.add(str(m.Name))
  }
  return [...names].sort()
}

export function toContainerInfo(raw: unknown): ContainerInfo {
  const r = asRecord(raw)
  const id = str(r.Id)
  const first = Array.isArray(r.Names) ? str(r.Names[0]) : ''
  const name = first.replace(/^\//, '') || id.slice(0, 12)
  const state = STATES.includes(str(r.State)) ? (str(r.State) as ContainerState) : 'exited'
  const labels = asRecord(r.Labels)
  const project = str(labels['com.docker.compose.project'])
  const compose = project
    ? {
        project,
        service: str(labels['com.docker.compose.service']),
        workingDir: str(labels['com.docker.compose.project.working_dir']),
        configFiles: str(labels['com.docker.compose.project.config_files'])
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean)
      }
    : null
  return {
    id,
    name,
    image: str(r.Image),
    imageId: str(r.ImageID),
    state,
    status: str(r.Status),
    created: typeof r.Created === 'number' ? r.Created : 0,
    ports: formatPorts(r.Ports),
    volumes: volumeNames(r.Mounts),
    networks: Object.keys(asRecord(asRecord(r.NetworkSettings).Networks)).sort(),
    compose
  }
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0

export function groupContainers(list: ContainerInfo[]): {
  projects: ContainerProject[]
  standalone: ContainerInfo[]
} {
  const projects = new Map<string, ContainerProject>()
  const standalone: ContainerInfo[] = []
  for (const c of list) {
    if (!c.compose) {
      standalone.push(c)
      continue
    }
    let p = projects.get(c.compose.project)
    if (!p) {
      p = {
        name: c.compose.project,
        workingDir: c.compose.workingDir,
        configFiles: c.compose.configFiles,
        containers: []
      }
      projects.set(p.name, p)
    }
    p.containers.push(c)
  }
  const out = [...projects.values()].sort(byName)
  for (const p of out) p.containers.sort(byName)
  return { projects: out, standalone: standalone.sort(byName) }
}

export type ComposeAction = 'up' | 'pull' | 'restart' | 'down'
export const COMPOSE_ACTIONS: readonly ComposeAction[] = ['up', 'pull', 'restart', 'down']
export const COMPOSE_PROJECT = /^[a-z0-9][a-z0-9_-]*$/

export type HostTerminalRequest =
  | { kind: 'logs' | 'shell'; id: string }
  | { kind: 'compose'; project: string; action: ComposeAction }
  | { kind: 'build-cache-prune' }
  | { kind: 'resource-prune'; resource: ResourceKind }
