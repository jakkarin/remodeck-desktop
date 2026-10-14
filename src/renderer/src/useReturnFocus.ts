import { useEffect, useRef, type RefObject } from 'react'

/**
 * Hands focus back to `ref` after `active` goes true -> false (a dialog opened from a popover closing).
 * Radix restores focus to the element focused when the dialog opened, which is gone by then, so
 * focus would fall to <body>. Only acts when focus actually fell to <body>.
 */
export function useReturnFocus(active: boolean, ref: RefObject<HTMLElement | null>): void {
  const was = useRef(active)
  useEffect(() => {
    if (was.current && !active) {
      // after Radix's own FocusScope unmount handler (also a 0 ms timeout)
      window.setTimeout(() => {
        const current = document.activeElement
        if (!current || current === document.body) ref.current?.focus()
      }, 0)
    }
    was.current = active
  }, [active, ref])
}
