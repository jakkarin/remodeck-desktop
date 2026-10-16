import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import type { ContainerInfo } from '../../src/shared/containers'
import type { ResourceRow } from '../../src/shared/resources'
import type { Host } from '../../src/shared/types'

type ExitHandler = (tabId: string, code: number) => void
const exitHandlers = new Set<ExitHandler>()
const exitTerminal = (tabId: string): void => {
  act(() => {
    for (const handler of exitHandlers) handler(tabId, 0)
  })
}

vi.mock('../../src/renderer/src/api', () => ({
  api: {
    terminal: { close: vi.fn() },
    containers: {
      resources: vi.fn(),
      removeResource: vi.fn(),
      openTerminal: vi.fn()
    },
    on: vi.fn((event: string, handler: ExitHandler) => {
      if (event === 'terminal-exit') exitHandlers.add(handler)
      return () => {
        exitHandlers.delete(handler)
      }
    })
  },
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

beforeEach(() => {
  vi.clearAllMocks()
  exitHandlers.clear()
})

describe('ResourcesView', () => {
  it('loads rows and marks in-use from containers', async () => {
    vi.mocked(api.containers.resources).mockResolvedValue([
      row({ name: 'nginx:latest', id: 'sha256:a', size: 41943040 }),
      row({ name: 'redis:7', id: 'sha256:b' })
    ])
    render(<ResourcesView host={host} kind="image" containers={[ctr({ imageId: 'sha256:a' })]} />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('Alpha')
    fireEvent.change(screen.getByLabelText('Filter Images'), { target: { value: 'ALP' } })
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.queryByText('beta')).toBeNull()
    fireEvent.change(screen.getByLabelText('Filter Images'), { target: { value: 'zzz' } })
    expect(screen.getByText('Nothing matches the filter')).toBeInTheDocument()
    rerender(<ResourcesView host={host} kind="volume" containers={[]} />)
    expect(await screen.findByText('No volumes on Box')).toBeInTheDocument()
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
    expect(screen.getByText('Nothing matches the filter')).toBeInTheDocument()
    expect(screen.queryByRole('region')).toBeNull()
  })
})

describe('ResourcesView actions', () => {
  const prot: Host = { ...host, protected: true }
  const img = row({ name: 'nginx:latest', ref: 'nginx:latest' })
  const TYPE_LABEL = 'Type the host name to confirm'

  beforeEach(() => {
    vi.mocked(api.containers.resources).mockResolvedValue([img])
    vi.mocked(api.containers.removeResource).mockResolvedValue(undefined)
    vi.mocked(api.containers.openTerminal).mockResolvedValue({
      tabId: 'prune-tab',
      label: 'prune',
      hostId: 'h1'
    })
  })

  it('image Remove asks click on a normal host and calls removeResource with the tag', async () => {
    render(<ResourcesView host={host} kind="image" containers={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove nginx:latest' }))
    const dialog = screen.getByRole('alertdialog')
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
    const dialog = screen.getByRole('alertdialog')
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
    const dialog = screen.getByRole('alertdialog')
    expect(
      within(dialog).getByText('prune images — removes only untagged (dangling) images')
    ).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Prune' })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText(TYPE_LABEL), { target: { value: 'Box' } })
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(api.containers.openTerminal).toHaveBeenCalledWith('h1', {
        kind: 'resource-prune',
        resource: 'image'
      })
    )
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
    // The row's last cell is the action slot: one empty placeholder for the built-in row.
    expect(first.lastElementChild?.children).toHaveLength(1)
  })

  it.each(['image', 'volume', 'network'] as const)(
    'opens each prune type in a terminal after confirmation: %s',
    async (kind) => {
      render(<ResourcesView host={host} kind={kind} containers={[]} />)
      fireEvent.click(await screen.findByRole('button', { name: `Prune ${kind}s` }))
      expect(api.containers.openTerminal).not.toHaveBeenCalled()
      const dialog = screen.getByRole('alertdialog')
      if (kind === 'volume') {
        expect(within(dialog).getByRole('button', { name: 'Prune' })).toBeDisabled()
        fireEvent.change(within(dialog).getByLabelText(TYPE_LABEL), { target: { value: 'Box' } })
      }
      fireEvent.click(within(dialog).getByRole('button', { name: 'Prune' }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(api.containers.openTerminal).toHaveBeenCalledWith('h1', {
        kind: 'resource-prune',
        resource: kind
      })
    }
  )

  it('reloads the list only after its prune terminal exits', async () => {
    render(<ResourcesView host={host} kind="image" containers={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Prune images' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Prune' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('button', { name: 'Prune images' })).toBeDisabled()
    expect(api.containers.resources).toHaveBeenCalledTimes(1)
    exitTerminal('other-tab')
    expect(api.containers.resources).toHaveBeenCalledTimes(1)
    vi.mocked(api.containers.resources).mockResolvedValueOnce([])
    exitTerminal('prune-tab')
    expect(await screen.findByText('No images on Box')).toBeInTheDocument()
    expect(screen.queryByText('nginx:latest')).toBeNull()
  })

  it('finishes the prune once, even if its tab reports exit again', async () => {
    render(<ResourcesView host={host} kind="image" containers={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Prune images' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Prune' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('button', { name: 'Prune images' })).toBeDisabled()
    // Main answers a user close with exit -1, the same path as a finished command.
    exitTerminal('prune-tab')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prune images' })).toBeEnabled())
    expect(api.containers.resources).toHaveBeenCalledTimes(2)
    exitTerminal('prune-tab')
    expect(api.containers.resources).toHaveBeenCalledTimes(2)
  })

  it('prune confirm states the scope per kind', async () => {
    const want = {
      volume:
        'prune volumes — removes volumes no container uses (Docker ≥ 23 removes only anonymous volumes)',
      network: 'prune networks — removes networks no container uses'
    } as const
    for (const kind of ['volume', 'network'] as const) {
      const { unmount } = render(<ResourcesView host={host} kind={kind} containers={[]} />)
      fireEvent.click(await screen.findByRole('button', { name: `Prune ${kind}s` }))
      expect(within(screen.getByRole('alertdialog')).getByText(want[kind])).toBeInTheDocument()
      unmount()
    }
  })

  it('a row tagged prune:image does not mark the Prune button busy', async () => {
    vi.mocked(api.containers.resources).mockResolvedValue([
      row({ name: 'prune:image', ref: 'prune:image' }),
      row({ name: 'other:1', ref: 'other:1' })
    ])
    vi.mocked(api.containers.removeResource).mockReturnValue(new Promise<void>(() => {}))
    render(<ResourcesView host={host} kind="image" containers={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove prune:image' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api.containers.removeResource).toHaveBeenCalled())
    // The confirm stays open (removeResource never settles) and hides the page from the a11y tree.
    expect(screen.getByRole('button', { name: 'Prune images', hidden: true })).toBeEnabled()
  })

  it('terminal opening failures remain in the confirmation and can be retried', async () => {
    vi.mocked(api.containers.openTerminal).mockRejectedValueOnce(new Error('SSH unavailable'))
    render(<ResourcesView host={host} kind="image" containers={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Prune images' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Prune' }))
    expect(await screen.findByText('SSH unavailable')).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Prune' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(api.containers.openTerminal).toHaveBeenCalledTimes(2)
  })

  it('reloads after a fast terminal exit received before its opening reply', async () => {
    vi.mocked(api.containers.openTerminal).mockImplementationOnce(async () => {
      exitTerminal('prune-tab')
      return { tabId: 'prune-tab', hostId: 'h1', label: 'prune' }
    })
    render(<ResourcesView host={host} kind="image" containers={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Prune images' }))
    vi.mocked(api.containers.resources).mockResolvedValueOnce([])
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Prune' }))
    expect(await screen.findByText('No images on Box')).toBeInTheDocument()
    expect(api.containers.openTerminal).toHaveBeenCalledTimes(1)
  })

  it('does not reload a different host when the old prune terminal exits', async () => {
    const { rerender } = render(<ResourcesView host={host} kind="image" containers={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Prune images' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Prune' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    rerender(<ResourcesView host={{ ...host, id: 'h2' }} kind="image" containers={[]} />)
    await screen.findByText('nginx:latest')
    exitTerminal('prune-tab')
    expect(api.containers.resources).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: 'Prune images' })).toBeEnabled()
  })

  it('remove error (in use) shows the Thai message in the banner and reloads', async () => {
    const msg = 'This image is in use by a container — remove that container first'
    vi.mocked(api.containers.removeResource).mockRejectedValue(new Error(msg))
    render(<ResourcesView host={host} kind="image" containers={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove nginx:latest' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText(msg)).toBeInTheDocument()
    await waitFor(() => expect(api.containers.resources).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alertdialog')).toBeNull()
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
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(rm).toBeDisabled())
    fireEvent.click(rm)
    expect(api.containers.removeResource).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(rm).toBeEnabled())

    let finishPrune: () => void = () => {}
    vi.mocked(api.containers.openTerminal).mockImplementation(
      () =>
        new Promise(
          (r) => (finishPrune = () => r({ tabId: 'prune-tab', hostId: 'h1', label: 'prune' }))
        )
    )
    const pr = screen.getByRole('button', { name: 'Prune images' })
    fireEvent.click(pr)
    fireEvent.click(pr)
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Prune' }))
    await waitFor(() => expect(pr).toBeDisabled())
    expect(api.containers.openTerminal).toHaveBeenCalledTimes(1)
    await act(async () => finishPrune())
    expect(pr).toBeDisabled()
    exitTerminal('prune-tab')
    await waitFor(() => expect(pr).toBeEnabled())
  })
})
