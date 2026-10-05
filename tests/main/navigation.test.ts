import { describe, it, expect } from 'vitest'
import { isAppNavigation } from '../../src/main/navigation'

describe('isAppNavigation', () => {
  it('allows only the dev renderer origin', () => {
    expect(isAppNavigation('http://localhost:5173/x', 'http://localhost:5173')).toBe(true)
    expect(isAppNavigation('http://localhost:5174/', 'http://localhost:5173')).toBe(false)
    expect(isAppNavigation('file:///C:/a.png', 'http://localhost:5173')).toBe(false)
  })
  it('blocks everything in production and on bad urls', () => {
    expect(isAppNavigation('file:///app/index.html', undefined)).toBe(false)
    expect(isAppNavigation('not a url', 'http://localhost:5173')).toBe(false)
  })
})
