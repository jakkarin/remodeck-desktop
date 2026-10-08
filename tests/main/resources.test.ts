import { describe, expect, it } from 'vitest'
import {
  IMAGE_REF,
  NETWORK_ID,
  VOLUME_NAME,
  isInUse,
  parsePrune,
  toImageRows,
  toNetworkRows,
  toVolumeRows,
  type ResourceRow
} from '../../src/shared/resources'
import type { ContainerInfo } from '../../src/shared/containers'

const SHA = 'a'.repeat(64)

const container = (over: Partial<ContainerInfo>): ContainerInfo => ({
  id: 'abc',
  name: 'c',
  image: 'x',
  imageId: '',
  state: 'running',
  status: '',
  created: 0,
  ports: [],
  volumes: [],
  networks: [],
  compose: null,
  ...over
})

describe('toImageRows', () => {
  it('one row per tag, dangling image by short id, sorted', () => {
    const rows = toImageRows([
      { Id: 'sha256:abcdef0123456789', RepoTags: ['<none>:<none>'], Size: 5, Created: 10 },
      { Id: 'sha256:111111111111aaaa', RepoTags: ['b:2', 'a:1'], Size: 7, Created: 20 },
      { Id: 'sha256:fedcba9876543210', RepoTags: null, Size: 1, Created: 30 }
    ])
    expect(rows.map((r) => r.name)).toEqual(['a:1', 'abcdef012345', 'b:2', 'fedcba987654'])
    const a = rows.find((r) => r.name === 'a:1')!
    expect(a).toEqual({
      kind: 'image',
      ref: 'a:1',
      name: 'a:1',
      id: 'sha256:111111111111aaaa',
      size: 7,
      created: 20000,
      driver: '',
      builtIn: false
    })
    expect(rows.find((r) => r.name === 'b:2')!.id).toBe(a.id)
    const dangling = rows.find((r) => r.name === 'abcdef012345')!
    expect(dangling.ref).toBe('sha256:abcdef0123456789')
  })
})

describe('toVolumeRows / toNetworkRows', () => {
  it('maps volume fields', () => {
    const rows = toVolumeRows({
      Volumes: [
        { Name: 'z', Driver: 'local', CreatedAt: '2025-10-05T10:00:00Z' },
        { Name: 'a', Driver: 'nfs' }
      ]
    })
    expect(rows.map((r) => r.name)).toEqual(['a', 'z'])
    expect(rows[1]).toEqual({
      kind: 'volume',
      ref: 'z',
      name: 'z',
      id: 'z',
      size: null,
      created: Date.parse('2025-10-05T10:00:00Z'),
      driver: 'local',
      builtIn: false
    })
    expect(rows[0].created).toBeNull()
  })

  it('maps network fields; bridge/host/none are builtIn', () => {
    const rows = toNetworkRows([
      {
        Id: 'f'.repeat(64),
        Name: 'shop_default',
        Driver: 'bridge',
        Created: '2025-10-05T10:00:00Z'
      },
      { Id: 'e'.repeat(64), Name: 'bridge', Driver: 'bridge' },
      { Id: 'd'.repeat(64), Name: 'host', Driver: 'host' },
      { Id: 'c'.repeat(64), Name: 'none', Driver: 'null' }
    ])
    expect(rows.map((r) => [r.name, r.builtIn])).toEqual([
      ['bridge', true],
      ['host', true],
      ['none', true],
      ['shop_default', false]
    ])
    const shop = rows[3]
    expect(shop.ref).toBe('f'.repeat(64))
    expect(shop.id).toBe('f'.repeat(64))
    expect(shop.created).toBe(Date.parse('2025-10-05T10:00:00Z'))
    expect(shop.size).toBeNull()
    expect(shop.kind).toBe('network')
  })

  it('tolerates malformed input', () => {
    expect(toImageRows(null)).toEqual([])
    expect(toVolumeRows({})).toEqual([])
    expect(toNetworkRows('x')).toEqual([])
  })
})

describe('isInUse', () => {
  const row = (kind: ResourceRow['kind'], name: string, id: string): ResourceRow => ({
    kind,
    ref: name,
    name,
    id,
    size: null,
    created: null,
    driver: '',
    builtIn: false
  })
  const cs = [container({ imageId: 'sha256:1', volumes: ['v1'], networks: ['n1'] })]
  it('per kind', () => {
    expect(isInUse(row('image', 'a:1', 'sha256:1'), cs)).toBe(true)
    expect(isInUse(row('image', 'a:1', 'sha256:2'), cs)).toBe(false)
    expect(isInUse(row('volume', 'v1', 'v1'), cs)).toBe(true)
    expect(isInUse(row('volume', 'v2', 'v2'), cs)).toBe(false)
    expect(isInUse(row('network', 'n1', 'x'), cs)).toBe(true)
    expect(isInUse(row('network', 'n2', 'x'), cs)).toBe(false)
  })
})

describe('parsePrune', () => {
  it('per kind; null lists count 0', () => {
    expect(parsePrune('image', { ImagesDeleted: [{}, {}], SpaceReclaimed: 99 })).toEqual({
      deleted: 2,
      reclaimed: 99
    })
    expect(parsePrune('image', { ImagesDeleted: null, SpaceReclaimed: 0 })).toEqual({
      deleted: 0,
      reclaimed: 0
    })
    expect(parsePrune('volume', { VolumesDeleted: ['a'], SpaceReclaimed: 5 })).toEqual({
      deleted: 1,
      reclaimed: 5
    })
    expect(parsePrune('volume', { VolumesDeleted: null })).toEqual({ deleted: 0, reclaimed: null })
    expect(parsePrune('network', { NetworksDeleted: ['a', 'b'] })).toEqual({
      deleted: 2,
      reclaimed: null
    })
    expect(parsePrune('network', { NetworksDeleted: null })).toEqual({
      deleted: 0,
      reclaimed: null
    })
  })
})

describe('validators', () => {
  it('IMAGE_REF accepts and rejects', () => {
    for (const ok of [
      'nginx:1.27',
      'ghcr.io/o/app:v1',
      `sha256:${'a'.repeat(64)}`,
      `app@sha256:${SHA}`,
      'localhost:5000/app:1',
      'myreg:5000/team/app',
      `library/redis@sha256:${SHA}`
    ])
      expect(IMAGE_REF.test(ok), ok).toBe(true)
    for (const bad of [
      '../x',
      'a/../x',
      'a/.',
      'a/./b',
      'a//b',
      'a/',
      'Upper/app',
      'a:..',
      'a?b',
      'a#b',
      'a%2f',
      'a b',
      ''
    ])
      expect(IMAGE_REF.test(bad), bad).toBe(false)
  })
  it('VOLUME_NAME / NETWORK_ID accept and reject', () => {
    expect(VOLUME_NAME.test('my_vol-1.x')).toBe(true)
    expect(VOLUME_NAME.test('-bad')).toBe(false)
    expect(VOLUME_NAME.test('a/b')).toBe(false)
    expect(NETWORK_ID.test('a'.repeat(12))).toBe(true)
    expect(NETWORK_ID.test('a'.repeat(65))).toBe(false)
    expect(NETWORK_ID.test('bridge')).toBe(false)
  })
})
