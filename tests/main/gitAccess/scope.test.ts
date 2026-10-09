import { describe, expect, it } from 'vitest'
import {
  compareScopes,
  isValidTokenValue,
  matchScope,
  normalizeScopePath,
  validateScope
} from '../../../src/shared/gitAccess'

describe('git access scope model', () => {
  it('normalizes scope paths', () => {
    expect(normalizeScopePath('/Org-A/Payments.git/')).toBe('org-a/payments')
  })

  it('validates scopes', () => {
    expect(validateScope('github.com', 'org-a/../x')).toMatch(/segment/)
    expect(validateScope('github.com', 'org a')).not.toBeNull()
    expect(validateScope('GitHub.com', 'org-a')).not.toBeNull()
    expect(validateScope('github.com', '')).not.toBeNull()
    expect(validateScope('github.com', 'org-a/payments')).toBeNull()
  })

  it('rejects dot-only and empty host labels', () => {
    expect(validateScope('..', 'x')).not.toBeNull()
    expect(validateScope('.', 'x')).not.toBeNull()
    expect(validateScope('a..b', 'x')).not.toBeNull()
    expect(validateScope('.github.com', 'x')).not.toBeNull()
    expect(validateScope('github.com.', 'x')).not.toBeNull()
    expect(validateScope('-', 'x')).not.toBeNull()
    expect(validateScope('github.com', 'org-a')).toBeNull()
  })

  it('matches the most specific scope for a repo path', () => {
    const items = [
      { host: 'github.com', path: 'org-a' },
      { host: 'github.com', path: 'org-a/payments' }
    ]
    expect(matchScope(items, 'github.com', 'Org-A/Payments.git')).toBe(items[1])
    expect(matchScope(items, 'github.com', 'org-a/x')).toBe(items[0])
    expect(matchScope(items, 'github.com', 'org-ab/x')).toBeNull()
    expect(matchScope(items, 'gitlab.com', 'org-a/x')).toBeNull()
  })

  it('sorts scopes by host then path segment', () => {
    const sorted = ['org-a/payments', 'org-a-x', 'org-a']
      .map((p) => ({ host: 'github.com', path: p }))
      .sort(compareScopes)
      .map((s) => s.path)
    expect(sorted).toEqual(['org-a', 'org-a/payments', 'org-a-x'])
  })

  it('validates token values', () => {
    expect(isValidTokenValue("github_pat_ABC$`'\\")).toBe(true)
    expect(isValidTokenValue('a b')).toBe(false)
    expect(isValidTokenValue('a\nb')).toBe(false)
    expect(isValidTokenValue('x'.repeat(513))).toBe(false)
  })
})
