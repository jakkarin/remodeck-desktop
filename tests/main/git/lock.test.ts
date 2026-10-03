import { describe, expect, it } from 'vitest'
import { withLock } from '../../../src/main/git/lock'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('withLock', () => {
  it('serializes calls with the same key in FIFO order', async () => {
    const order: string[] = []
    const task = (name: string) => async () => {
      order.push(`${name}-start`)
      await sleep(50)
      order.push(`${name}-end`)
    }
    await Promise.all([withLock('m', task('a')), withLock('m', task('b'))])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
  })

  it('lets different keys overlap', async () => {
    const order: string[] = []
    const task = (name: string) => async () => {
      order.push(`${name}-start`)
      await sleep(50)
      order.push(`${name}-end`)
    }
    await Promise.all([withLock('x', task('a')), withLock('y', task('b'))])
    expect(order.slice(0, 2).sort()).toEqual(['a-start', 'b-start'])
  })

  it('releases the lock after a rejection', async () => {
    await expect(
      withLock('r', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    await expect(withLock('r', async () => 7)).resolves.toBe(7)
  })
})
