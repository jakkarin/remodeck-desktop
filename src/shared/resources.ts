// Shared between main and renderer: types and pure functions only, no node imports.
import type { ContainerInfo } from './containers'

export type ResourceKind = 'image' | 'volume' | 'network'
export const RESOURCE_KINDS: readonly ResourceKind[] = ['image', 'volume', 'network']

export type ResourceRow = {
  kind: ResourceKind
  /** What main uses to remove the resource. */
  ref: string
  name: string
  id: string
  size: number | null
  /** Epoch milliseconds. */
  created: number | null
  driver: string
  builtIn: boolean
}

export type PruneResult = { deleted: number; reclaimed: number | null }

// Docker reference grammar: [domain[:port]/]component(/component)*[:tag][@sha256:digest], or a full id.
const PATH_COMPONENT = String.raw`[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*`
const DOMAIN_COMPONENT = String.raw`[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?`
// Like Docker, a first segment is only a registry host if it has a dot or port, or is localhost.
const DOMAIN = String.raw`(?:${DOMAIN_COMPONENT}(?:\.${DOMAIN_COMPONENT})+(?::[0-9]+)?/|${DOMAIN_COMPONENT}:[0-9]+/|localhost/)?`
const NAME = `${DOMAIN}${PATH_COMPONENT}(?:/${PATH_COMPONENT})*`
export const IMAGE_REF = new RegExp(
  String.raw`^(?:sha256:[a-f0-9]{64}|${NAME}(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?)$`
)
export const VOLUME_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
export const NETWORK_ID = /^[a-f0-9]{12,64}$/

const asRecord = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const byName = (a: ResourceRow, b: ResourceRow): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0

const parseDate = (v: unknown): number | null => {
  const t = Date.parse(str(v))
  return Number.isNaN(t) ? null : t
}

export function toImageRows(raw: unknown): ResourceRow[] {
  const rows: ResourceRow[] = []
  for (const entry of list(raw)) {
    const r = asRecord(entry)
    const id = str(r.Id)
    if (!id) continue
    const size = num(r.Size)
    const created = typeof r.Created === 'number' ? r.Created * 1000 : null
    const tags = list(r.RepoTags).filter(
      (t): t is string => typeof t === 'string' && t !== '' && t !== '<none>:<none>'
    )
    if (tags.length === 0) {
      rows.push({
        kind: 'image',
        ref: id,
        name: id.replace(/^sha256:/, '').slice(0, 12),
        id,
        size,
        created,
        driver: '',
        builtIn: false
      })
      continue
    }
    for (const tag of tags) {
      rows.push({
        kind: 'image',
        ref: tag,
        name: tag,
        id,
        size,
        created,
        driver: '',
        builtIn: false
      })
    }
  }
  return rows.sort(byName)
}

export function toVolumeRows(raw: unknown): ResourceRow[] {
  const rows: ResourceRow[] = []
  for (const entry of list(asRecord(raw).Volumes)) {
    const r = asRecord(entry)
    const name = str(r.Name)
    if (!name) continue
    rows.push({
      kind: 'volume',
      ref: name,
      name,
      id: name,
      size: null,
      created: parseDate(r.CreatedAt),
      driver: str(r.Driver),
      builtIn: false
    })
  }
  return rows.sort(byName)
}

const BUILT_IN_NETWORKS: readonly string[] = ['bridge', 'host', 'none']

export function toNetworkRows(raw: unknown): ResourceRow[] {
  const rows: ResourceRow[] = []
  for (const entry of list(raw)) {
    const r = asRecord(entry)
    const id = str(r.Id)
    const name = str(r.Name)
    if (!id || !name) continue
    rows.push({
      kind: 'network',
      ref: id,
      name,
      id,
      size: null,
      created: parseDate(r.Created),
      driver: str(r.Driver),
      builtIn: BUILT_IN_NETWORKS.includes(name)
    })
  }
  return rows.sort(byName)
}

export function isInUse(row: ResourceRow, containers: ContainerInfo[]): boolean {
  switch (row.kind) {
    case 'image':
      return containers.some((c) => c.imageId === row.id)
    case 'volume':
      return containers.some((c) => c.volumes.includes(row.name))
    case 'network':
      return containers.some((c) => c.networks.includes(row.name))
  }
}

export function parsePrune(kind: ResourceKind, raw: unknown): PruneResult {
  const r = asRecord(raw)
  switch (kind) {
    case 'image':
      return { deleted: list(r.ImagesDeleted).length, reclaimed: num(r.SpaceReclaimed) }
    case 'volume':
      return { deleted: list(r.VolumesDeleted).length, reclaimed: num(r.SpaceReclaimed) }
    case 'network':
      return { deleted: list(r.NetworksDeleted).length, reclaimed: null }
  }
}
