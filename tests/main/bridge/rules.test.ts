import { describe, expect, it } from 'vitest'
import { evaluateRules } from '../../../src/main/bridge/rules'
import { ZERO_SHA } from '../../../src/main/bridge/pktline'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const policy = { enforceRules: true, protectedBranches: ['main', 'release'] }

describe('evaluateRules', () => {
  it('blocks deletions', () => {
    expect(evaluateRules([{ oldSha: A, newSha: ZERO_SHA, ref: 'refs/heads/feat' }], policy)).toEqual({
      allowed: false,
      reason: 'ห้ามลบ refs/heads/feat'
    })
  })
  it('blocks 64-hex zero deletions', () => {
    const r = evaluateRules([{ oldSha: A, newSha: '0'.repeat(64), ref: 'refs/tags/v1' }], policy)
    expect(r.allowed).toBe(false)
  })
  it('blocks protected branches', () => {
    expect(evaluateRules([{ oldSha: A, newSha: B, ref: 'refs/heads/main' }], policy)).toEqual({
      allowed: false,
      reason: 'branch main ถูกป้องกัน'
    })
  })
  it('matches protected names exactly', () => {
    expect(evaluateRules([{ oldSha: A, newSha: B, ref: 'refs/heads/main2' }], policy).allowed).toBe(true)
    expect(evaluateRules([{ oldSha: A, newSha: B, ref: 'refs/heads/feat/main' }], policy).allowed).toBe(true)
  })
  it('allows other branches and tags', () => {
    expect(evaluateRules([{ oldSha: A, newSha: B, ref: 'refs/heads/feat' }], policy)).toEqual({ allowed: true })
    expect(evaluateRules([{ oldSha: ZERO_SHA, newSha: B, ref: 'refs/tags/v1' }], policy)).toEqual({ allowed: true })
  })
  it('allows everything when enforceRules is false', () => {
    const off = { enforceRules: false, protectedBranches: ['main'] }
    expect(
      evaluateRules(
        [
          { oldSha: A, newSha: ZERO_SHA, ref: 'refs/heads/main' },
          { oldSha: A, newSha: B, ref: 'refs/heads/main' }
        ],
        off
      )
    ).toEqual({ allowed: true })
  })
  it('returns the first violation', () => {
    const r = evaluateRules(
      [
        { oldSha: A, newSha: B, ref: 'refs/heads/feat' },
        { oldSha: A, newSha: B, ref: 'refs/heads/release' },
        { oldSha: A, newSha: ZERO_SHA, ref: 'refs/heads/x' }
      ],
      policy
    )
    expect(r).toEqual({ allowed: false, reason: 'branch release ถูกป้องกัน' })
  })
})
