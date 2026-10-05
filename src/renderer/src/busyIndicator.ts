export type BusyIndicator = {
  /** Marks one operation as started; call the returned function when it settles. */
  begin(): () => void
  dispose(): void
}

/**
 * Debounced busy flag: becomes visible only if work is still running after `delayMs`,
 * then stays visible for at least `minVisibleMs` so it never flashes.
 */
export function createBusyIndicator(
  onChange: (visible: boolean) => void,
  { delayMs = 300, minVisibleMs = 300 }: { delayMs?: number; minVisibleMs?: number } = {}
): BusyIndicator {
  let count = 0
  let visible = false
  let shownAt = 0
  let showTimer: ReturnType<typeof setTimeout> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  const set = (v: boolean): void => {
    if (visible === v) return
    visible = v
    onChange(v)
  }
  const clear = (): void => {
    if (showTimer) clearTimeout(showTimer)
    if (hideTimer) clearTimeout(hideTimer)
    showTimer = hideTimer = null
  }

  return {
    begin() {
      count++
      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
      }
      if (!visible && !showTimer) {
        showTimer = setTimeout(() => {
          showTimer = null
          if (count > 0) {
            shownAt = Date.now()
            set(true)
          }
        }, delayMs)
      }
      let ended = false
      return () => {
        if (ended) return
        ended = true
        count--
        if (count > 0) return
        if (showTimer) {
          clearTimeout(showTimer)
          showTimer = null
        }
        if (visible) {
          const wait = Math.max(0, shownAt + minVisibleMs - Date.now())
          if (wait === 0) set(false)
          else {
            hideTimer = setTimeout(() => {
              hideTimer = null
              if (count === 0) set(false)
            }, wait)
          }
        }
      }
    },
    dispose() {
      clear()
      count = 0
    }
  }
}
