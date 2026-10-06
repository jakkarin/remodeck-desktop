/**
 * Per-host cache of a probe result. Only successful results are stored; concurrent
 * callers share one in-flight run; a result is stored only while its run is still
 * the current one (a forced run or `clear` supersedes older in-flight runs).
 */
export class ProbeCache<T> {
  private readonly results = new Map<string, T>()
  private readonly probing = new Map<string, Promise<T>>()

  get(hostId: string, force: boolean, run: (current: () => boolean) => Promise<T>): Promise<T> {
    if (force) this.clear(hostId)
    else {
      if (this.results.has(hostId)) return Promise.resolve(this.results.get(hostId) as T)
      const existing = this.probing.get(hostId)
      if (existing) return existing
    }
    const p: Promise<T> = run(() => this.probing.get(hostId) === p).then((value) => {
      if (this.probing.get(hostId) === p) this.results.set(hostId, value)
      return value
    })
    this.probing.set(hostId, p)
    const done = (): void => {
      if (this.probing.get(hostId) === p) this.probing.delete(hostId)
    }
    p.then(done, done)
    return p
  }

  clear(hostId: string): void {
    this.results.delete(hostId)
    this.probing.delete(hostId)
  }
}
