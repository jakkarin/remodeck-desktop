import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ContainerInfo } from '../../src/shared/containers'
import type { ResourceRow } from '../../src/shared/resources'
import type { Host } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: { containers: { resources: vi.fn(), removeResource: vi.fn(), prune: vi.fn() } },
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

  it('does not render an empty group next to the empty/filter messages', async () => {
    vi.mocked(api.containers.resources).mockResolvedValue([row({ name: 'Alpha' })])
    render(<ResourcesView host={host} kind="image" containers={[]} />)
    await screen.findByText('Alpha')
    fireEvent.change(screen.getByLabelText('Filter Images'), { target: { value: 'zzz' } })
    expect(screen.getByText('ไม่มีรายการที่ตรงกับตัวกรอง')).toBeInTheDocument()
    expect(screen.queryByRole('region')).toBeNull()
  })
})

describe('ResourcesView actions', () => {
  const prot: Host = { ...host, protected: true }
  const img = row({ name: 'nginx:latest', ref: 'nginx:latest' })
  const TYPE_LABEL = 'พิมพ์ชื่อ host เพื่อยืนยัน'

  beforeEach(() => {
    vi.mocked(api.containers.resources).mockResolvedValue([img])
    vi.mocked(api.containers.removeResource).mockResolvedValue(undefined)
    vi.mocked(api.containers.prune).mockResolvedValue({ deleted: 0, reclaimed: null })
  })

  it('image Remove asks click on a normal host and calls removeResource with the tag', async () => {
    render(<ResourcesView host={host} kind="image" containers={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove nginx:latest' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('remove image · nginx:latest')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(TYPE_LABEL)).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(api.containers.removeResource).toHaveBeenCalledWith('h1', 'image', 'nginx:latest')
    )
    await waitFor(() => expect(api.containers.resources).toHaveBeenCalledTimes(2))
  })

  it('volume Remove always asks for the typed host label', async () => {
    vi.mocked(api.containers.resources).mockResolvedValue([
      row({ kind: 'volume', name: 'data', ref: 'data' })
    ])
    render(<ResourcesView host={host} kind="volume" containers={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove data' }))
    const dialog = screen.getByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Remove' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText(TYPE_LABEL), { target: { value: 'Box' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(api.containers.removeResource).toHaveBeenCalledWith('h1', 'volume', 'data')
    )
  })

  it('protected host: image prune requires the typed host label', async () => {
    render(<ResourcesView host={prot} kind="image" containers={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Prune images' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('prune images')).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Prune' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText(TYPE_LABEL), { target: { value: 'Box' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(api.containers.prune).toHaveBeenCalledWith('h1', 'image'))
  })

  it('built-in network has no Remove button but keeps an empty slot', async () => {
    vi.mocked(api.containers.resources).mockResolvedValue([
      row({ kind: 'network', name: 'bridge', ref: 'bridge', builtIn: true }),
      row({ kind: 'network', name: 'app', ref: 'app' })
    ])
    render(<ResourcesView host={host} kind="network" containers={[]} />)
    await screen.findByText('app')
    expect(screen.queryByRole('button', { name: 'Remove bridge' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove app' })).toBeInTheDocument()
    const [first] = within(screen.getByRole('region', { name: 'Networks' })).getAllByRole(
      'listitem'
    )
    expect(first.querySelector('.resource-actions')?.children).toHaveLength(1)
  })

  it('prune shows the result line and reloads', async () => {
    vi.mocked(api.containers.prune).mockResolvedValue({ deleted: 3, reclaimed: 41943040 })
    render(<ResourcesView host={host} kind="image" containers={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Prune images' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Prune' }))
    expect(await screen.findByText('ลบแล้ว 3 รายการ · คืนพื้นที่ 40 MB')).toBeInTheDocument()
    await waitFor(() => expect(api.containers.resources).toHaveBeenCalledTimes(2))
  })

  it('prune without reclaimed omits the space part', async () => {
    vi.mocked(api.containers.prune).mockResolvedValue({ deleted: 2, reclaimed: null })
    render(<ResourcesView host={host} kind="image" containers={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Prune images' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Prune' }))
    expect(await screen.findByText('ลบแล้ว 2 รายการ')).toBeInTheDocument()
  })

  it('remove error (in use) shows the Thai message in the banner and reloads', async () => {
    const msg = 'image นี้ถูกใช้โดย container อยู่ ต้องลบ container นั้นก่อน'
    vi.mocked(api.containers.removeResource).mockRejectedValue(new Error(msg))
    render(<ResourcesView host={host} kind="image" containers={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove nginx:latest' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText(msg)).toBeInTheDocument()
    await waitFor(() => expect(api.containers.resources).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('busy: double-clicking Remove or Prune opens one confirm/one call', async () => {
    let finish: () => void = () => {}
    vi.mocked(api.containers.removeResource).mockImplementation(
      () => new Promise<void>((r) => (finish = r))
    )
    render(<ResourcesView host={host} kind="image" containers={[]} />)
    const rm = await screen.findByRole('button', { name: 'Remove nginx:latest' })
    fireEvent.click(rm)
    fireEvent.click(rm)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(rm).toBeDisabled())
    fireEvent.click(rm)
    expect(api.containers.removeResource).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(rm).toBeEnabled())

    let finishPrune: () => void = () => {}
    vi.mocked(api.containers.prune).mockImplementation(
      () => new Promise((r) => (finishPrune = () => r({ deleted: 0, reclaimed: null })))
    )
    const pr = screen.getByRole('button', { name: 'Prune images' })
    fireEvent.click(pr)
    fireEvent.click(pr)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Prune' }))
    await waitFor(() => expect(pr).toBeDisabled())
    expect(api.containers.prune).toHaveBeenCalledTimes(1)
    finishPrune()
    await waitFor(() => expect(pr).toBeEnabled())
  })
})
