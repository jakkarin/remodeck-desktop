import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ContainerInfo } from '../../src/shared/containers'
import type { ResourceRow } from '../../src/shared/resources'
import type { Host } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: { containers: { resources: vi.fn() } },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { ResourcesView } from '../../src/renderer/src/components/ResourcesView'

const host: Host = { id: 'h1', sshHost: 'a', label: 'Box', protected: false }

const row = (over: Partial<ResourceRow>): ResourceRow => ({
  kind: 'image',
  ref: 'x',
  name: 'x',
  id: 'x',
  size: null,
  created: null,
  driver: '',
  builtIn: false,
  ...over
})
const ctr = (over: Partial<ContainerInfo>): ContainerInfo => ({
  id: 'c1',
  name: 'web',
  image: 'nginx',
  imageId: '',
  state: 'running',
  status: 'Up',
  created: 0,
  ports: [],
  volumes: [],
  networks: [],
  compose: null,
  ...over
})

beforeEach(() => vi.clearAllMocks())

describe('ResourcesView', () => {
  it('loads rows and marks in-use from containers', async () => {
    vi.mocked(api.containers.resources).mockResolvedValue([
      row({ name: 'nginx:latest', id: 'sha256:a', size: 41943040 }),
      row({ name: 'redis:7', id: 'sha256:b' })
    ])
    render(<ResourcesView host={host} kind="image" containers={[ctr({ imageId: 'sha256:a' })]} />)
    expect(screen.getByText('กำลังโหลด…')).toBeInTheDocument()
    expect(await screen.findByText('nginx:latest')).toBeInTheDocument()
    expect(api.containers.resources).toHaveBeenCalledWith('h1', 'image')
    const region = screen.getByRole('region', { name: 'Images' })
    const [first, second] = within(region).getAllByRole('listitem')
    expect(within(first).getByText('in use')).toBeInTheDocument()
    expect(within(first).getByText('40 MB')).toBeInTheDocument()
    expect(within(second).queryByText('in use')).toBeNull()
  })

  it('shows driver and built-in badge for networks', async () => {
    vi.mocked(api.containers.resources).mockResolvedValue([
      row({ kind: 'network', name: 'bridge', driver: 'bridge', builtIn: true })
    ])
    render(<ResourcesView host={host} kind="network" containers={[]} />)
    await screen.findByText('bridge', { selector: '.mono' })
    expect(screen.getByText('built-in')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Networks' })).toBeInTheDocument()
  })

  it('filter, empty and error-retry states', async () => {
    vi.mocked(api.containers.resources)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([row({ name: 'Alpha' }), row({ name: 'beta' })])
      .mockResolvedValueOnce([])
    const { rerender } = render(<ResourcesView host={host} kind="image" containers={[]} />)
    expect(await screen.findByText('boom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }))
    await screen.findByText('Alpha')
    fireEvent.change(screen.getByLabelText('Filter Images'), { target: { value: 'ALP' } })
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByText('beta')).toBeNull()
    fireEvent.change(screen.getByLabelText('Filter Images'), { target: { value: 'zzz' } })
    expect(screen.getByText('ไม่มีรายการที่ตรงกับตัวกรอง')).toBeInTheDocument()
    rerender(<ResourcesView host={host} kind="volume" containers={[]} />)
    expect(await screen.findByText('ยังไม่มี volume บน Box')).toBeInTheDocument()
  })

  it('ignores a late response after switching kind', async () => {
    let lateImages: (v: ResourceRow[]) => void = () => {}
    vi.mocked(api.containers.resources).mockImplementation((_h, kind) =>
      kind === 'image'
        ? new Promise((r) => (lateImages = r))
        : Promise.resolve([row({ kind: 'volume', name: 'data' })])
    )
    const { rerender } = render(<ResourcesView host={host} kind="image" containers={[]} />)
    rerender(<ResourcesView host={host} kind="volume" containers={[]} />)
    await screen.findByText('data')
    lateImages([row({ name: 'stale:image' })])
    await waitFor(() => expect(screen.queryByText('stale:image')).toBeNull())
    expect(screen.getByText('data')).toBeInTheDocument()
  })
})
