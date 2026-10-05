import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApprovalService } from '../../src/main/approval/approvalService'
import { Store } from '../../src/main/store/store'
import type { ApprovalDecision, ApprovalRequest } from '../../src/shared/types'

let dir: string
let store: Store
let repoId: string

beforeEach(() => {
  vi.useFakeTimers()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regit-approval-'))
  store = new Store(dir)
  repoId = store.upsertRepo('acme', 'api').id
})
afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(dir, { recursive: true, force: true })
})

const base = (sessionId = 's1') => ({
  repoId,
  repoLabel: 'acme/api',
  sessionId,
  tabLabel: 'Terminal 1',
  updates: [
    { oldSha: 'a', newSha: 'b', ref: 'refs/heads/feat/x' },
    { oldSha: 'c', newSha: 'd', ref: 'refs/heads/fix' }
  ]
})

function make(decision: ApprovalDecision | Promise<ApprovalDecision> | (() => Promise<ApprovalDecision>)) {
  const prompt = vi.fn(async (_req: ApprovalRequest) =>
    typeof decision === 'function' ? decision() : decision
  )
  const notify = vi.fn()
  return { svc: new ApprovalService({ store, prompt, notify }), prompt, notify }
}

describe('ApprovalService', () => {
  it('once allows and prompts again next time, with a generated id', async () => {
    const { svc, prompt } = make('once')
    expect(await svc.request(base())).toBe(true)
    expect(await svc.request(base())).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(prompt.mock.calls[0][0].id).toBeTruthy()
    expect(prompt.mock.calls[0][0].id).not.toBe(prompt.mock.calls[1][0].id)
  })

  it('session grants only that session until revoked', async () => {
    const { svc, prompt } = make('session')
    expect(await svc.request(base('s1'))).toBe(true)
    expect(await svc.request(base('s1'))).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)
    await svc.request(base('s2'))
    expect(prompt).toHaveBeenCalledTimes(2)
    svc.revokeSession('s1')
    await svc.request(base('s1'))
    expect(prompt).toHaveBeenCalledTimes(3)
  })

  it('always persists, skips prompt next time and notifies', async () => {
    const { svc, prompt, notify } = make('always')
    expect(await svc.request(base())).toBe(true)
    expect(store.config.repos[0].alwaysAllowPush).toBe(true)
    expect(notify).not.toHaveBeenCalled()
    expect(await svc.request(base('other'))).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('Push feat/x, fix → acme/api')
  })

  it('reads alwaysAllowPush fresh so revoking takes effect', async () => {
    const { svc, prompt } = make('once')
    store.updateRepo(repoId, { alwaysAllowPush: true })
    await svc.request(base())
    expect(prompt).not.toHaveBeenCalled()
    store.updateRepo(repoId, { alwaysAllowPush: false })
    await svc.request(base())
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('deny returns false', async () => {
    const { svc } = make('deny')
    expect(await svc.request(base())).toBe(false)
  })

  it('unknown repo is denied without prompting', async () => {
    const { svc, prompt } = make('always')
    expect(await svc.request({ ...base(), repoId: 'nope' })).toBe(false)
    expect(prompt).not.toHaveBeenCalled()
  })

  it('prompt rejection is treated as deny', async () => {
    const { svc } = make(() => Promise.reject(new Error('window closed')))
    expect(await svc.request(base())).toBe(false)
  })

  it('no answer within 60s denies, and timer is cleared when prompt settles', async () => {
    const { svc } = make(() => new Promise<ApprovalDecision>(() => {}))
    const p = svc.request(base())
    await vi.advanceTimersByTimeAsync(59_999)
    let settled = false
    void p.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toBe(false)

    const { svc: svc2 } = make('once')
    await svc2.request(base())
    expect(vi.getTimerCount()).toBe(0)
  })
})
