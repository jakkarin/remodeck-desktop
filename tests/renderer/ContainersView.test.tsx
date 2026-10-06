import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ContainerInfo } from '../../src/shared/containers'
import type { Host } from '../../src/shared/types'

type Handler = (...args: never[]) => void
const handlers: Record<string, Set<Handler>> = {}

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    containers: { open: vi.fn(), action: vi.fn() },
    on: vi.fn((event: string, cb: Handler) => {
      ;(handlers[event] ??= new Set()).add(cb)
      return () => handlers[event].delete(cb)
    })
  },
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e))
}))

import { api } from '../../src/renderer/src/api'
import { ContainersView } from '../../src/renderer/src/components/ContainersView'

const host: Host = { id: 'h1', sshHost: 'a', label: 'Box', protected: false }
const prot: Host = { ...host, protected: true }

const mk = (name: string, over: Partial<ContainerInfo> = {}): ContainerInfo => ({
  id: name.padEnd(12, '0'),
  name,
  image: `${name}-image`,
  state: 'running',
  status: 'Up 1 hour',
  created: 0,
  ports: ['8080→80/tcp', '443/tcp'],
  compose: null,
  ...over
})
const comp = { project: 'shop', service: 's', workingDir: '/w', configFiles: [] }
const LIST = [
  mk('web', { compose: comp }),
  mk('db', { compose: comp, state: 'exited', status: 'Exited' }),
  mk('solo'),
  mk('old', { state: 'exited', status: 'Exited' })
]

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  for (const k of Object.keys(handlers)) delete handlers[k]
  vi.mocked(api.containers.open).mockResolvedValue(LIST)
  vi.mocked(api.containers.action).mockResolvedValue(undefined)
})

describe('ContainersView', () => {
  it('groups compose projects and standalone, hiding stopped by default', async () => {
    render(<ContainersView host={host} />)
    expect(await screen.findByText('shop (compose)')).toBeInTheDocument()
    expect(screen.getByText('Standalone')).toBeInTheDocument()
    expect(screen.getByText('web')).toBeInTheDocument()
    expect(screen.getByText('solo')).toBeInTheDocument()
    expect(screen.queryByText('db')).toBeNull()
    expect(screen.queryByText('old')).toBeNull()
    expect(screen.getAllByText('8080→80/tcp, 443/tcp').length).toBeGreaterThan(0)
  })

  it('shows stopped containers with the checkbox', async () => {
    render(<ContainersView host={host} />)
    await screen.findByText('web')
    fireEvent.click(screen.getByLabelText('แสดงตัวที่หยุด'))
    expect(screen.getByText('db')).toBeInTheDocument()
    expect(screen.getByText('old')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start old' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop old' })).toBeNull()
  })

  it('filters by name or image, case-insensitively', async () => {
    render(<ContainersView host={host} />)
    await screen.findByText('web')
    fireEvent.change(screen.getByLabelText('Filter containers'), { target: { value: 'SOLO-IM' } })
    expect(screen.getByText('solo')).toBeInTheDocument()
    expect(screen.queryByText('web')).toBeNull()
    expect(screen.queryByText('shop (compose)')).toBeNull()
  })

  it('persists collapsed compose groups per host', async () => {
    const { unmount } = render(<ContainersView host={host} />)
    await screen.findByText('web')
    fireEvent.click(screen.getByRole('button', { name: /shop \(compose\)/ }))
    expect(screen.queryByText('web')).toBeNull()
    expect(JSON.parse(localStorage.getItem('remodeck.composeCollapsed') ?? '{}')).toEqual({
      h1: ['shop']
    })
    unmount()
    const second = render(<ContainersView host={host} />)
    await screen.findByText('solo')
    expect(screen.queryByText('web')).toBeNull()
    second.unmount()
    render(<ContainersView host={{ ...host, id: 'h2' }} />)
    expect(await screen.findByText('web')).toBeInTheDocument()
  })

  it('runs Stop directly on a normal host', async () => {
    render(<ContainersView host={host} />)
    await screen.findByText('web')
    fireEvent.click(screen.getByRole('button', { name: 'Stop web' }))
    await waitFor(() =>
      expect(api.containers.action).toHaveBeenCalledWith('h1', 'web'.padEnd(12, '0'), 'stop')
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks for a click confirm to Stop on a protected host', async () => {
    render(<ContainersView host={prot} />)
    await screen.findByText('web')
    fireEvent.click(screen.getByRole('button', { name: 'Stop web' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('stop · web')).toBeInTheDocument()
    expect(api.containers.action).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(api.containers.action).toHaveBeenCalled())
  })

  it('requires typing the label to Remove on a protected host', async () => {
    render(<ContainersView host={prot} />)
    await screen.findByText('web')
    fireEvent.click(screen.getByRole('button', { name: 'Remove web' }))
    const confirm = screen.getByRole('button', { name: 'Remove' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('พิมพ์ชื่อ host เพื่อยืนยัน'), {
      target: { value: 'Box' }
    })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(api.containers.action).toHaveBeenCalledWith('h1', 'web'.padEnd(12, '0'), 'remove')
    )
  })

  it('shows an action error in the banner and clears it on success', async () => {
    vi.mocked(api.containers.action).mockRejectedValueOnce(new Error('boom'))
    render(<ContainersView host={host} />)
    await screen.findByText('web')
    fireEvent.click(screen.getByRole('button', { name: 'Stop web' }))
    expect(await screen.findByText('boom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restart web' }))
    await waitFor(() => expect(screen.queryByText('boom')).toBeNull())
  })

  it('shows the live-paused badge', async () => {
    render(<ContainersView host={host} />)
    await screen.findByText('web')
    expect(screen.queryByText('หยุดอัปเดตสด')).toBeNull()
    for (const cb of handlers['containers-live'] ?? []) {
      ;(cb as (...a: unknown[]) => void)('h1', false)
    }
    expect(await screen.findByText('หยุดอัปเดตสด')).toBeInTheDocument()
  })

  it('shows the connection error with Retry', async () => {
    vi.mocked(api.containers.open).mockRejectedValueOnce(new Error('no socket'))
    render(<ContainersView host={host} />)
    expect(await screen.findByText('เชื่อมต่อ docker บน Box ไม่ได้')).toBeInTheDocument()
    expect(screen.getByText('no socket')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('web')).toBeInTheDocument()
  })

  it('shows the empty message', async () => {
    vi.mocked(api.containers.open).mockResolvedValue([])
    render(<ContainersView host={host} />)
    expect(await screen.findByText('ยังไม่มี container บน Box')).toBeInTheDocument()
  })
})
