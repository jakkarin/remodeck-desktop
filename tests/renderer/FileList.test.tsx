import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ANIMATE_ROW_LIMIT, FileList } from '../../src/renderer/src/components/FileList'
import type { FileChange } from '../../src/shared/types'

const makeFiles = (n: number): FileChange[] =>
  Array.from({ length: n }, (_, i) => ({
    path: `src/f${i}.ts`,
    status: 'M',
    additions: 1,
    deletions: 0
  })) as FileChange[]

describe('FileList', () => {
  it('animates file rows only up to the limit', () => {
    const { container, rerender } = render(
      <FileList files={makeFiles(3)} selected={null} onSelect={() => {}} />
    )
    expect(container.querySelector('[data-animated="true"]')).not.toBeNull()
    rerender(
      <FileList files={makeFiles(ANIMATE_ROW_LIMIT + 1)} selected={null} onSelect={() => {}} />
    )
    expect(container.querySelector('[data-animated="true"]')).toBeNull()
  })
})
