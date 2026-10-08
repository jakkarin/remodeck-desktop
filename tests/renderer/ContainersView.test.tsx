import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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

vi.mock('../../src/renderer/src/terminalEvents', () => ({ openHostTerminal: vi.fn() }))

import { api } from '../../src/renderer/src/api'
import { openHostTerminal } from '../../src/renderer/src/terminalEvents'
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
  vi.mocked(api.containers.open).mockResolvedValue({ list: LIST, live: true })
  vi.mocked(api.containers.action).mockResolvedValue(undefined)
  vi.mocked(openHostTerminal).mockResolvedValue({} as never)
})

describe('ContainersView', () => {
  it('keeps each project’s metadata and actions in its own named list group', async () => {
    vi.mocked(api.containers.open).mockResolvedValue({
      list: [
        mk('web', { compose: comp }),
        mk('worker', { compose: { ...comp, project: 'jobs' } }),
        mk('solo', { ports: [] })
      ],
      live: true
    })
    render(<ContainersView host={host} />)
    const shop = await screen.findByRole('region', { name: 'shop (compose)' })
    const row = within(within(shop).getByRole('list')).getByRole('listitem')
    expect(within(row).getByText('web-image')).toBeInTheDocument()
    expect(within(row).getByText('Running')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Stop web' })).toBeInTheDocument()
    expect(within(shop).queryByText('worker')).toBeNull()
    expect(
      within(screen.getByRole('region', { name: 'jobs (compose)' })).getByText('worker')
    ).toBeInTheDocument()
    const standalone = screen.getByRole('region', { name: 'Standalone' })
    expect(within(standalone).getByText('No ports')).toBeInTheDocument()
    expect(within(standalone).queryByText('web')).toBeNull()
  })

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
    expect(screen.getByText('web')).not.toBeVisible()
    expect(JSON.parse(localStorage.getItem('remodeck.composeCollapsed') ?? '{}')).toEqual({
      h1: ['shop']
    })
    unmount()
    const second = render(<ContainersView host={host} />)
    await screen.findByText('solo')
    expect(screen.getByText('web')).not.toBeVisible()
    second.unmount()
    render(<ContainersView host={{ ...host, id: 'h2' }} />)
    expect(await screen.findByText('web')).toBeInTheDocument()
  })

  it('offers Start only for stopped containers and Stop/Restart only for running ones', async () => {
    render(<ContainersView host={host} />)
    await screen.findByText('web')
    fireEvent.click(screen.getByLabelText('แสดงตัวที่หยุด'))
    expect(screen.getByRole('button', { name: 'Stop web' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restart web' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start web' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Start old' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop old' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Restart old' })).toBeNull()
  })

  it('collapses a compose project and wires the toggle to its list', async () => {
    render(<ContainersView host={host} />)
    const shop = await screen.findByRole('region', { name: 'shop (compose)' })
    const toggle = within(shop).getByRole('button', { name: /shop \(compose\)/ })
    const listId = toggle.getAttribute('aria-controls') ?? ''
    expect(document.getElementById(listId)).not.toBeNull()
    expect(within(shop).getByText('web')).toBeVisible()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById(listId)).not.toBeVisible()
    expect(within(shop).queryByRole('listitem')).toBeNull()
    expect(screen.getByText('solo')).toBeVisible()
  })

  it('disables Start and Remove while a container is being removed', async () => {
    vi.mocked(api.containers.open).mockResolvedValue({
      list: [mk('gone', { state: 'removing', status: 'Removal In Progress' })],
      live: true
    })
    render(<ContainersView host={host} />)
    fireEvent.click(await screen.findByLabelText('แสดงตัวที่หยุด'))
    expect(screen.getByRole('button', { name: 'Start gone' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove gone' })).toBeDisabled()
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

  it('shows the stale badge when open reports the stream is not live', async () => {
    vi.mocked(api.containers.open).mockResolvedValue({ list: LIST, live: false })
    render(<ContainersView host={host} />)
    await screen.findByText('web')
    expect(screen.getByText('หยุดอัปเดตสด')).toBeInTheDocument()
  })

  it('disables the buttons of a container while its action runs, so a double click sends once', async () => {
    let finish: () => void = () => {}
    vi.mocked(api.containers.action).mockImplementation(
      () => new Promise<void>((r) => (finish = () => r()))
    )
    render(<ContainersView host={host} />)
    await screen.findByText('web')
    const stop = screen.getByRole('button', { name: 'Stop web' })
    fireEvent.click(stop)
    fireEvent.click(stop)
    expect(api.containers.action).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Remove web' })).toBeDisabled()
    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove web' })).toBeEnabled())
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
    vi.mocked(api.containers.open).mockResolvedValue({ list: [], live: true })
    render(<ContainersView host={host} />)
    expect(await screen.findByText('ยังไม่มี container บน Box')).toBeInTheDocument()
  })

  it('drops an open confirm when the host changes and never acts on the new host', async () => {
    const hostB: Host = { ...prot, id: 'h2', label: 'Other' }
    const { rerender } = render(<ContainersView host={prot} />)
    await screen.findByText('web')
    fireEvent.click(screen.getByRole('button', { name: 'Stop web' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    rerender(<ContainersView host={hostB} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.containers.action).not.toHaveBeenCalled()
  })

  it('says when filters hide every row', async () => {
    render(<ContainersView host={host} />)
    await screen.findByText('web')
    fireEvent.change(screen.getByLabelText('Filter containers'), { target: { value: 'zzz' } })
    expect(screen.getByText('ไม่มี container ที่ตรงกับตัวกรอง')).toBeInTheDocument()
  })

  it('Logs opens a logs terminal for that container', async () => {
    render(<ContainersView host={host} />)
    await screen.findByText('web')
    fireEvent.click(screen.getByRole('button', { name: 'Logs web' }))
    await waitFor(() =>
      expect(openHostTerminal).toHaveBeenCalledWith('h1', {
        kind: 'logs',
        id: 'web'.padEnd(12, '0')
      })
    )
  })

  it('Shell is disabled for a stopped container and opens shell for a running one', async () => {
    render(<ContainersView host={host} />)
    await screen.findByText('web')
    fireEvent.click(screen.getByLabelText('แสดงตัวที่หยุด'))
    expect(screen.getByRole('button', { name: 'Shell old' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Logs old' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Shell web' }))
    await waitFor(() =>
      expect(openHostTerminal).toHaveBeenCalledWith('h1', {
        kind: 'shell',
        id: 'web'.padEnd(12, '0')
      })
    )
  })

  it('compose Up runs immediately on a normal host', async () => {
    render(<ContainersView host={host} />)
    await screen.findByText('web')
    fireEvent.click(screen.getByRole('button', { name: 'Up shop' }))
    await waitFor(() =>
      expect(openHostTerminal).toHaveBeenCalledWith('h1', {
        kind: 'compose',
        project: 'shop',
        action: 'up'
      })
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('compose Up asks for click confirm on a protected host', async () => {
    render(<ContainersView host={prot} />)
    await screen.findByText('web')
    fireEvent.click(screen.getByRole('button', { name: 'Up shop' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('up · shop')).toBeInTheDocument()
    expect(openHostTerminal).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Up' }))
    await waitFor(() =>
      expect(openHostTerminal).toHaveBeenCalledWith('h1', {
        kind: 'compose',
        project: 'shop',
        action: 'up'
      })
    )
  })

  it('compose Down asks click on normal and typed host label on protected', async () => {
    const first = render(<ContainersView host={host} />)
    await screen.findByText('web')
    fireEvent.click(screen.getByRole('button', { name: 'Down shop' }))
    const click = within(screen.getByRole('dialog')).getByRole('button', { name: 'Down' })
    expect(click).toBeEnabled()
    expect(openHostTerminal).not.toHaveBeenCalled()
    first.unmount()
    render(<ContainersView host={prot} />)
    await screen.findByText('web')
    fireEvent.click(screen.getByRole('button', { name: 'Down shop' }))
    const typed = within(screen.getByRole('dialog')).getByRole('button', { name: 'Down' })
    expect(typed).toBeDisabled()
    fireEvent.change(screen.getByLabelText('พิมพ์ชื่อ host เพื่อยืนยัน'), {
      target: { value: 'Box' }
    })
    fireEvent.click(typed)
    await waitFor(() =>
      expect(openHostTerminal).toHaveBeenCalledWith('h1', {
        kind: 'compose',
        project: 'shop',
        action: 'down'
      })
    )
  })

  it('compose group tooltip shows the path, or the missing-path hint', async () => {
    vi.mocked(api.containers.open).mockResolvedValue({
      list: [
        mk('web', { compose: { ...comp, configFiles: ['a.yml', 'b.yml'] } }),
        mk('worker', { compose: { ...comp, project: 'jobs', workingDir: '', configFiles: [] } })
      ],
      live: true
    })
    render(<ContainersView host={host} />)
    const shop = await screen.findByRole('region', { name: 'shop (compose)' })
    expect(within(shop).getByRole('button', { name: /shop \(compose\)/ })).toHaveAttribute(
      'title',
      '/w · a.yml, b.yml'
    )
    const jobs = screen.getByRole('region', { name: 'jobs (compose)' })
    expect(within(jobs).getByRole('button', { name: /jobs \(compose\)/ })).toHaveAttribute(
      'title',
      'ไม่พบ path ของ compose project (ผลจริงดูใน terminal)'
    )
  })

  it('openHostTerminal rejection shows the error banner', async () => {
    vi.mocked(openHostTerminal).mockRejectedValueOnce(new Error('no pty'))
    render(<ContainersView host={host} />)
    await screen.findByText('web')
    fireEvent.click(screen.getByRole('button', { name: 'Logs web' }))
    expect(await screen.findByText('no pty')).toBeInTheDocument()
  })
})
