import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  dockerErrorMessage,
  listResources,
  removeResource
} from '../../../src/main/docker/resources'
import { DockerError } from '../../../src/main/docker/dockerClient'

const NET = 'c'.repeat(64)

function fake(reply: unknown = []): {
  json: Mock<(...a: unknown[]) => Promise<unknown>>
  client: never
} {
  const json = vi.fn(async (): Promise<unknown> => reply) as never
  return { json, client: { json } as never }
}

describe('resources', () => {
  it('lists each kind via the right path and parser', async () => {
    const i = fake([{ Id: 'sha256:' + 'a'.repeat(64), RepoTags: ['app:1'], Size: 5, Created: 2 }])
    const rows = await listResources(i.client, 'image')
    expect(i.json.mock.calls[0].slice(0, 2)).toEqual(['GET', '/images/json'])
    expect(rows.map((r) => r.ref)).toEqual(['app:1'])

    const v = fake({ Volumes: [{ Name: 'data', Driver: 'local' }] })
    expect((await listResources(v.client, 'volume')).map((r) => r.ref)).toEqual(['data'])
    expect(v.json.mock.calls[0].slice(0, 2)).toEqual(['GET', '/volumes'])

    const n = fake([{ Id: NET, Name: 'bridge', Driver: 'bridge' }])
    const nets = await listResources(n.client, 'network')
    expect(n.json.mock.calls[0].slice(0, 2)).toEqual(['GET', '/networks'])
    expect(nets[0]).toMatchObject({ ref: NET, builtIn: true })
  })

  it('remove image by tag keeps slashes: DELETE /images/ghcr.io/o/app%3Av1', async () => {
    const t = fake()
    await removeResource(t.client, 'image', 'ghcr.io/o/app:v1')
    expect(t.json).toHaveBeenCalledWith('DELETE', '/images/ghcr.io/o/app%3Av1', undefined, {
      timeoutMs: 120000
    })
    await removeResource(t.client, 'volume', 'data')
    expect(t.json).toHaveBeenLastCalledWith('DELETE', '/volumes/data', undefined, {
      timeoutMs: 120000
    })
    await removeResource(t.client, 'network', NET)
    expect(t.json).toHaveBeenLastCalledWith('DELETE', `/networks/${NET}`, undefined, {
      timeoutMs: 120000
    })
  })

  it('remove rejects bad refs before any request', async () => {
    const t = fake()
    await expect(removeResource(t.client, 'image', '../x')).rejects.toThrow('Invalid image name')
    await expect(removeResource(t.client, 'volume', 'a?b')).rejects.toThrow('Invalid volume name')
    await expect(removeResource(t.client, 'volume', 'a b')).rejects.toThrow('Invalid volume name')
    await expect(removeResource(t.client, 'network', 'bridge')).rejects.toThrow(
      'Invalid network name'
    )
    expect(t.json).not.toHaveBeenCalled()
  })

  it('dockerErrorMessage maps 404/409/403 cases to the Thai copy and passes others through', () => {
    const m = (k: 'image' | 'volume' | 'network', s: number, msg = 'x'): string =>
      dockerErrorMessage(k, new DockerError(s, msg)).message
    expect(m('image', 404)).toBe('This image no longer exists')
    expect(m('volume', 404)).toBe('This volume no longer exists')
    expect(m('network', 404)).toBe('This network no longer exists')
    const inUse = 'This image is in use by a container — remove that container first'
    expect(
      m('image', 409, 'unable to delete abc - image is being used by running container x')
    ).toBe(inUse)
    expect(m('image', 409, 'image is in use by a stopped container')).toBe(inUse)
    expect(m('image', 409, 'image is referenced in multiple repositories')).toBe(
      'image is referenced in multiple repositories'
    )
    expect(m('image', 409, 'image has dependent child images')).toBe(
      'image has dependent child images'
    )
    expect(m('volume', 409)).toBe(
      'This volume is in use by a container — remove that container first'
    )
    expect(m('network', 403, 'error while removing network: has active endpoints')).toBe(
      'This network still has containers attached'
    )
    expect(m('network', 409, 'network has Active Endpoints')).toBe(
      'This network still has containers attached'
    )
    expect(m('network', 403, 'bridge is a pre-defined network and cannot be removed')).toBe(
      'Built-in networks (bridge/host/none) cannot be removed'
    )
    expect(m('network', 403, 'something else')).toBe('something else')
    expect(m('image', 500, 'boom')).toBe('boom')
    const other = new TypeError('net down')
    expect(dockerErrorMessage('image', other)).toBe(other)
  })
})
