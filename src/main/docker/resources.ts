import {
  IMAGE_REF,
  NETWORK_ID,
  VOLUME_NAME,
  parsePrune,
  toImageRows,
  toNetworkRows,
  toVolumeRows,
  type PruneResult,
  type ResourceKind,
  type ResourceRow
} from '../../shared/resources'
import { DockerError, type DockerClient } from './dockerClient'

type Client = Pick<DockerClient, 'json'>

const TIMEOUT = { timeoutMs: 120000 }
const BASE: Record<ResourceKind, string> = {
  image: '/images',
  volume: '/volumes',
  network: '/networks'
}
const VALID: Record<ResourceKind, RegExp> = {
  image: IMAGE_REF,
  volume: VOLUME_NAME,
  network: NETWORK_ID
}

export const PREDEFINED_NETWORK_MESSAGE = 'Built-in networks (bridge/host/none) cannot be removed'

export async function listResources(client: Client, kind: ResourceKind): Promise<ResourceRow[]> {
  switch (kind) {
    case 'image':
      return toImageRows(await client.json('GET', '/images/json'))
    case 'volume':
      return toVolumeRows(await client.json('GET', '/volumes'))
    case 'network':
      return toNetworkRows(await client.json('GET', '/networks'))
  }
}

// Docker's image route takes the full name, so `/` stays; `:` and `@` are encoded per segment.
const encodePath = (ref: string): string => ref.split('/').map(encodeURIComponent).join('/')

export async function removeResource(
  client: Client,
  kind: ResourceKind,
  ref: string
): Promise<void> {
  if (!VALID[kind].test(ref)) throw new Error(`Invalid ${kind} name`)
  await client.json('DELETE', `${BASE[kind]}/${encodePath(ref)}`, undefined, TIMEOUT)
}

export async function pruneResources(client: Client, kind: ResourceKind): Promise<PruneResult> {
  const raw = await client.json('POST', `${BASE[kind]}/prune`, undefined, TIMEOUT)
  return parsePrune(kind, raw)
}

export function dockerErrorMessage(kind: ResourceKind, e: unknown): Error {
  if (!(e instanceof DockerError)) return e instanceof Error ? e : new Error(String(e))
  if (e.status === 404) return new Error(`This ${kind} no longer exists`)
  if (e.status === 409 && kind === 'volume')
    return new Error(`This volume is in use by a container — remove that container first`)
  if (e.status === 409 && kind === 'image' && /being used|is using|in use/i.test(e.message))
    return new Error(`This ${kind} is in use by a container — remove that container first`)
  if (kind === 'network' && (e.status === 403 || e.status === 409)) {
    if (/active endpoints/i.test(e.message))
      return new Error('This network still has containers attached')
    if (e.status === 403 && /pre-defined|predefined/i.test(e.message))
      return new Error(PREDEFINED_NETWORK_MESSAGE)
  }
  return new Error(e.message)
}
