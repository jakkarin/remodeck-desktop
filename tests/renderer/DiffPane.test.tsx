import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DiffPane } from '../../src/renderer/src/components/DiffPane'

const lines = (n: number): string => Array.from({ length: n }, (_, i) => `+line${i + 1}`).join('\n')

describe('DiffPane', () => {
  it('colours added, removed and hunk lines', () => {
    render(<DiffPane text={'@@ -1 +1 @@\n-old\n+new'} path="a.ts" />)
    expect(screen.getByText('+new').className).toContain('diff-add')
    expect(screen.getByText('-old').className).toContain('diff-del')
    expect(screen.getByText('@@ -1 +1 @@').className).toContain('diff-hunk')
  })

  it('renders lines inside the width-wrapping container', () => {
    render(<DiffPane text={'+a\n-b'} path="a.ts" />)
    expect(screen.getByText('+a').parentElement?.className).toBe('diff-lines')
    expect(screen.getByText('-b').parentElement?.className).toBe('diff-lines')
  })

  it('shows the path, and old → new for renames', () => {
    const { rerender } = render(<DiffPane text="" path="a.ts" />)
    expect(screen.getByText('a.ts')).toBeInTheDocument()
    rerender(<DiffPane text="" path="b.ts" oldPath="a.ts" />)
    expect(screen.getByText('a.ts → b.ts')).toBeInTheDocument()
  })

  it('truncates at 5000 lines until "แสดงทั้งหมด" is clicked', () => {
    render(<DiffPane text={lines(5001)} path="big.ts" />)
    expect(screen.getByText('+line5000')).toBeInTheDocument()
    expect(screen.queryByText('+line5001')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'แสดงทั้งหมด' }))
    expect(screen.getByText('+line5001')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'แสดงทั้งหมด' })).toBeNull()
  })

  it('exactly 5000 lines has no show-all button', () => {
    render(<DiffPane text={lines(5000)} path="big.ts" />)
    expect(screen.queryByRole('button', { name: 'แสดงทั้งหมด' })).toBeNull()
  })

  it('binary files show a message instead of a diff', () => {
    render(<DiffPane text="" path="logo.png" binary />)
    expect(screen.getByText('Binary file')).toBeInTheDocument()
  })
})
