import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConfirmDanger } from '../../src/renderer/src/components/ConfirmDanger'

const host = { id: 'h1', sshHost: 'box', label: 'Box', protected: true }

function setup(mode: 'click' | 'type', onConfirm = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn()
  render(
    <ConfirmDanger
      host={host}
      summary="Remove container web"
      confirmLabel="Remove"
      mode={mode}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )
  return { onConfirm, onClose }
}

describe('ConfirmDanger', () => {
  it('is named by the host label and shows the summary', () => {
    setup('click')
    expect(screen.getByRole('dialog', { name: 'Box' })).toBeInTheDocument()
    expect(screen.getByText('Remove container web')).toBeInTheDocument()
  })

  it('click mode confirms immediately and closes', async () => {
    const { onConfirm, onClose } = setup('click')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('type mode requires the exact host label', () => {
    setup('type')
    const input = screen.getByLabelText('พิมพ์ชื่อ host เพื่อยืนยัน')
    const btn = screen.getByRole('button', { name: 'Remove' })
    expect(btn).toBeDisabled()
    fireEvent.change(input, { target: { value: 'box' } })
    expect(btn).toBeDisabled()
    fireEvent.change(input, { target: { value: 'Box ' } })
    expect(btn).toBeDisabled()
    fireEvent.change(input, { target: { value: 'Box' } })
    expect(btn).toBeEnabled()
  })

  it('shows the error and stays open when onConfirm rejects', async () => {
    const { onClose } = setup('click', vi.fn().mockRejectedValue(new Error('boom')))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText(/boom/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Box' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled()
  })
})
