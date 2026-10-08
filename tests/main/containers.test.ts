import { describe, expect, it } from 'vitest'
import {
  CONTAINER_ID,
  groupContainers,
  toContainerInfo,
  type ContainerInfo
} from '../../src/shared/containers'

const raw = {
  Id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
  Names: ['/web-1'],
  Image: 'nginx:1.27',
  State: 'running',
  Status: 'Up 2 hours',
  Created: 1759700000,
  Ports: [
    { IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
    { IP: '::', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
    { PrivatePort: 443, Type: 'tcp' },
    { PrivatePort: 53, PublicPort: 5353, Type: 'udp' }
  ],
  ImageID: 'sha256:' + 'b'.repeat(64),
  Mounts: [
    { Type: 'volume', Name: 'db_data', Source: '/v/db_data', Destination: '/data' },
    { Type: 'bind', Source: '/srv/shop', Destination: '/app' },
    { Type: 'volume', Name: 'cache', Source: '/v/cache', Destination: '/cache' },
    { Type: 'volume', Name: 'db_data', Source: '/v/db_data', Destination: '/data2' }
  ],
  NetworkSettings: { Networks: { shop_default: {}, bridge: {} } },
  Labels: {
    'com.docker.compose.project': 'shop',
    'com.docker.compose.service': 'web',
    'com.docker.compose.project.working_dir': '/srv/shop',
    'com.docker.compose.project.config_files':
      '/srv/shop/compose.yml, /srv/shop/compose.override.yml'
  }
}

const mk = (name: string, project?: string): ContainerInfo => ({
  id: name.padEnd(12, '0'),
  name,
  image: 'img',
  imageId: '',
  state: 'running',
  status: 'Up',
  created: 1,
  ports: [],
  volumes: [],
  networks: [],
  compose: project
    ? { project, service: name, workingDir: `/srv/${project}`, configFiles: ['/srv/c.yml'] }
    : null
})

describe('toContainerInfo', () => {
  it('reads imageId, volume mounts (not bind mounts) and network names', () => {
    const c = toContainerInfo(raw)
    expect(c.imageId).toBe('sha256:' + 'b'.repeat(64))
    expect(c.volumes).toEqual(['cache', 'db_data'])
    expect(c.networks).toEqual(['bridge', 'shop_default'])
    const e = toContainerInfo({ Id: raw.Id })
    expect([e.imageId, e.volumes, e.networks]).toEqual(['', [], []])
  })

  it('maps a realistic entry', () => {
    const c = toContainerInfo(raw)
    expect(c.id).toBe(raw.Id)
    expect(c.name).toBe('web-1')
    expect(c.image).toBe('nginx:1.27')
    expect(c.state).toBe('running')
    expect(c.status).toBe('Up 2 hours')
    expect(c.created).toBe(1759700000)
  })

  it('formats, dedupes and sorts ports', () => {
    expect(toContainerInfo(raw).ports).toEqual(['5353→53/udp', '8080→80/tcp', '443/tcp'])
  })

  it('formats a published port without IP', () => {
    const c = toContainerInfo({ ...raw, Ports: [{ PrivatePort: 80, PublicPort: 81, Type: 'tcp' }] })
    expect(c.ports).toEqual(['81→80/tcp'])
  })

  it('parses compose labels with two config files', () => {
    expect(toContainerInfo(raw).compose).toEqual({
      project: 'shop',
      service: 'web',
      workingDir: '/srv/shop',
      configFiles: ['/srv/shop/compose.yml', '/srv/shop/compose.override.yml']
    })
  })

  it('returns null compose for non-compose containers', () => {
    expect(toContainerInfo({ ...raw, Labels: {} }).compose).toBeNull()
    expect(toContainerInfo({ ...raw, Labels: undefined }).compose).toBeNull()
  })

  it('falls back for missing names, ports, labels and unknown state', () => {
    const c = toContainerInfo({ Id: raw.Id, State: 'weird' })
    expect(c.name).toBe(raw.Id.slice(0, 12))
    expect(c.ports).toEqual([])
    expect(c.compose).toBeNull()
    expect(c.state).toBe('exited')
  })
})

describe('groupContainers', () => {
  it('groups by project, sorted, with standalone separate', () => {
    const g = groupContainers([
      mk('z', 'beta'),
      mk('b', 'alpha'),
      mk('solo'),
      mk('a', 'alpha'),
      mk('y', 'beta')
    ])
    expect(g.projects.map((p) => p.name)).toEqual(['alpha', 'beta'])
    expect(g.projects[0].containers.map((c) => c.name)).toEqual(['a', 'b'])
    expect(g.projects[1].containers.map((c) => c.name)).toEqual(['y', 'z'])
    expect(g.projects[0].workingDir).toBe('/srv/alpha')
    expect(g.projects[0].configFiles).toEqual(['/srv/c.yml'])
    expect(g.standalone.map((c) => c.name)).toEqual(['solo'])
  })
})

describe('CONTAINER_ID', () => {
  it('accepts short and full hex ids only', () => {
    expect(CONTAINER_ID.test('a1b2c3d4e5f6')).toBe(true)
    expect(CONTAINER_ID.test(raw.Id)).toBe(true)
    expect(CONTAINER_ID.test('web-1')).toBe(false)
    expect(CONTAINER_ID.test('a1b2c3')).toBe(false)
  })
})
