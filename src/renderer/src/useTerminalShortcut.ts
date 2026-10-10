import { useEffect, useRef } from 'react'

/**
 * Ctrl+` toggles the terminal dock. Registered in the capture phase on window so it fires before
 * xterm's helper textarea sees the key, and swallows it so the shell never receives it.
 */
export function useTerminalShortcut(onToggle: () => void, enabled = true): void {
  const toggleRef = useRef(onToggle)
  useEffect(() => {
    toggleRef.current = onToggle
  })
  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent): void => {
      if (e.repeat) return
      if (!e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.code !== 'Backquote') return
      e.preventDefault()
      e.stopPropagation()
      toggleRef.current()
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [enabled])
}
