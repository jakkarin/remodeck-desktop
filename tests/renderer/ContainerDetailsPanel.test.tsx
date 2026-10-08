import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { ContainerInfo } from '../../src/shared/containers'
import type { Host } from '../../src/shared/types'

vi.mock('../../src/renderer/src/api', () => ({
  api: { containers: { inspect: vi.fn() } },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { ContainerDetailsPanel } from '../../src/renderer/src/components/ContainerDetailsPanel'

const host: Host = { id: 'h1', sshHost: 'a', label: 'Box', protected: false }
const web: ContainerInfo = {
  id: 'web000000000',
  name: 'web',
  image: 'nginx',
  imageId: '',
  state: 'running',
  status: 'Up 1 hour',
  created: 0,
  ports: [],
  volumes: [],
  networks: [],
  compose: null
}

const RAW = {
  Created: '2026-01-02T03:04:05Z',
  Config: {
    Image: 'nginx:1',
    Env: ['SECRET=hunter2', 'MODE=prod'],
    Labels: { app: 'shop' }
  },
  State: { Status: 'running', ExitCode: 0 },
  HostConfig: { RestartPolicy: { Name: 'always' } },
  NetworkSettings: {
    Ports: { '80/tcp': [{ HostPort: '8080' }] },
    Networks: { bridge: { IPAddress: '172.17.0.2' } }
  },
  Mounts: [{ Source: '/data', Destination: '/var/data', RW: false }]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.containers.inspect).mockResolvedValue(RAW)
})

const openPanel = async (c: ContainerInfo = web): Promise<ReturnType<typeof render>> => {
  const r = render(<ContainerDetailsPanel host={host} container={c} onClose={() => {}} />)
  await screen.findByText('nginx:1')
  return r
}

describe('ContainerDetailsPanel', () => {
  it('panel loads inspect and shows overview fields', async () => {
    render(<ContainerDetailsPanel host={host} container={web} onClose={() => {}} />)
    expect(screen.getByText('กำลังโหลด…')).toBeInTheDocument()
    await screen.findByText('nginx:1')
    expect(api.containers.inspect).toHaveBeenCalledWith('h1', 'web000000000')
    const created = screen.getByText(new Date('2026-01-02T03:04:05Z').toLocaleString())
    expect(created).toHaveAttribute('title', '2026-01-02T03:04:05Z')
    expect(screen.getByText('running (exit 0)')).toBeInTheDocument()
    expect(screen.getByText('always')).toBeInTheDocument()
    expect(screen.getByText('8080→80/tcp')).toBeInTheDocument()
    expect(screen.getByText('/data → /var/data (ro)')).toBeInTheDocument()
    expect(screen.getByText('bridge 172.17.0.2')).toBeInTheDocument()
    expect(screen.getByText('app=shop')).toBeInTheDocument()
  })

  it('shows — for empty lists', async () => {
    vi.mocked(api.containers.inspect).mockResolvedValue({ Config: { Image: 'x' } })
    render(<ContainerDetailsPanel host={host} container={web} onClose={() => {}} />)
    await screen.findByText('x')
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
  })

  it("env values are hidden until that row's eye is pressed; other rows stay hidden", async () => {
    await openPanel()
    fireEvent.click(screen.getByRole('tab', { name: 'Env' }))
    expect(screen.queryByText('hunter2')).toBeNull()
    expect(screen.getAllByText('••••••')).toHaveLength(2)
    const eye = screen.getByRole('button', { name: 'แสดงค่า SECRET' })
    expect(eye).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(eye)
    expect(screen.getByText('hunter2')).toBeInTheDocument()
    expect(screen.queryByText('prod')).toBeNull()
    const hide = screen.getByRole('button', { name: 'ซ่อนค่า SECRET' })
    expect(hide).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(hide)
    expect(screen.queryByText('hunter2')).toBeNull()
  })

  it('there is no reveal-all control', async () => {
    await openPanel()
    fireEvent.click(screen.getByRole('tab', { name: 'Env' }))
    expect(screen.queryByRole('button', { name: /ทั้งหมด|all/i })).toBeNull()
  })

  it('shows a message when there are no env vars', async () => {
    vi.mocked(api.containers.inspect).mockResolvedValue({ Config: { Image: 'x', Env: [] } })
    render(<ContainerDetailsPanel host={host} container={web} onClose={() => {}} />)
    await screen.findByText('x')
    fireEvent.click(screen.getByRole('tab', { name: 'Env' }))
    expect(screen.getByText('ไม่มี environment variable')).toBeInTheDocument()
  })

  it('JSON tab shows <hidden: N vars> and no env values', async () => {
    await openPanel()
    fireEvent.click(screen.getByRole('tab', { name: 'JSON' }))
    expect(screen.getByRole('tab', { name: 'JSON' })).toHaveAttribute('aria-selected', 'true')
    const pre = document.querySelector('pre') as HTMLElement
    expect(pre.textContent).toContain('<hidden: 2 vars>')
    expect(pre.textContent).not.toContain('hunter2')
  })

  it('refetches when container state changes; ignores a stale response', async () => {
    let resolveFirst: (v: unknown) => void = () => {}
    vi.mocked(api.containers.inspect)
      .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce({ Config: { Image: 'fresh' } })
    const { rerender } = render(
      <ContainerDetailsPanel host={host} container={web} onClose={() => {}} />
    )
    rerender(
      <ContainerDetailsPanel
        host={host}
        container={{ ...web, state: 'exited', status: 'Exited' }}
        onClose={() => {}}
      />
    )
    await screen.findByText('fresh')
    expect(api.containers.inspect).toHaveBeenCalledTimes(2)
    resolveFirst({ Config: { Image: 'stale' } })
    await Promise.resolve()
    await Promise.resolve()
    expect(screen.queryByText('stale')).toBeNull()
    expect(screen.getByText('fresh')).toBeInTheDocument()
  })

  it('does not refetch when only the status text changes', async () => {
    const { rerender } = render(
      <ContainerDetailsPanel host={host} container={web} onClose={() => {}} />
    )
    await screen.findByText('nginx:1')
    rerender(
      <ContainerDetailsPanel
        host={host}
        container={{ ...web, status: 'Up 2 hours (healthy)' }}
        onClose={() => {}}
      />
    )
    await Promise.resolve()
    expect(api.containers.inspect).toHaveBeenCalledTimes(1)
  })

  it('falls back to the raw string for an invalid created date', async () => {
    vi.mocked(api.containers.inspect).mockResolvedValue({
      Created: 'not-a-date',
      Config: { Image: 'x' }
    })
    render(<ContainerDetailsPanel host={host} container={web} onClose={() => {}} />)
    expect(await screen.findByText('not-a-date')).toBeInTheDocument()
  })

  it('retry shows the loading state instead of stale details', async () => {
    let reject: (e: Error) => void = () => {}
    vi.mocked(api.containers.inspect)
      .mockResolvedValueOnce(RAW)
      .mockReturnValueOnce(new Promise((_r, j) => (reject = j)))
      .mockReturnValueOnce(new Promise(() => {}))
    const { rerender } = render(
      <ContainerDetailsPanel host={host} container={web} onClose={() => {}} />
    )
    await screen.findByText('nginx:1')
    rerender(
      <ContainerDetailsPanel
        host={host}
        container={{ ...web, state: 'exited' }}
        onClose={() => {}}
      />
    )
    reject(new Error('boom'))
    fireEvent.click(await screen.findByRole('button', { name: 'ลองอีกครั้ง' }))
    expect(screen.getByText('กำลังโหลด…')).toBeInTheDocument()
    expect(screen.queryByText('nginx:1')).toBeNull()
  })

  it('scrolls itself into view on mount when supported', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      await openPanel()
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('inspect error shows message and ลองอีกครั้ง retries', async () => {
    vi.mocked(api.containers.inspect).mockRejectedValueOnce(new Error('container นี้ถูกลบไปแล้ว'))
    render(<ContainerDetailsPanel host={host} container={web} onClose={() => {}} />)
    expect(await screen.findByText('container นี้ถูกลบไปแล้ว')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ลองอีกครั้ง' }))
    expect(await screen.findByText('nginx:1')).toBeInTheDocument()
    expect(screen.queryByText('container นี้ถูกลบไปแล้ว')).toBeNull()
  })

  it('close button calls onClose', async () => {
    const onClose = vi.fn()
    render(<ContainerDetailsPanel host={host} container={web} onClose={onClose} />)
    await screen.findByText('nginx:1')
    fireEvent.click(
      within(screen.getByRole('complementary')).getByRole('button', { name: 'ปิดรายละเอียด' })
    )
    expect(onClose).toHaveBeenCalled()
    await waitFor(() => expect(api.containers.inspect).toHaveBeenCalled())
  })
})
