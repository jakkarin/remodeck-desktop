import { useEffect, useState, useSyncExternalStore } from 'react'
import { CircleCheck, CircleX, X } from 'lucide-react'
import { dismissToast, getToasts, subscribeToasts, type Toast } from '../toast'

// Errors stay longer: their message (e.g. git's rejection reason) needs reading.
const DURATION_MS: Record<Toast['tone'], number> = { success: 4000, error: 8000 }

function ToastItem({ toast }: { toast: Toast }): React.JSX.Element {
  // Hovering pauses the countdown so the toast can be read; the bar shows the time left.
  const [paused, setPaused] = useState(false)
  const [remaining, setRemaining] = useState(DURATION_MS[toast.tone])

  useEffect(() => {
    if (paused) return
    const startedAt = Date.now()
    const startRemaining = remaining
    const timer = window.setInterval(() => {
      const left = startRemaining - (Date.now() - startedAt)
      if (left <= 0) dismissToast(toast.id)
      else setRemaining(left)
    }, 50)
    return () => window.clearInterval(timer)
    // `remaining` is only read when (re)starting the countdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, toast.id])

  const Icon = toast.tone === 'success' ? CircleCheck : CircleX
  return (
    <div
      className={`toast toast-${toast.tone}`}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="toast-body">
        <Icon className="toast-icon" size={18} aria-hidden="true" />
        <div className="toast-text">
          <div className="toast-title">{toast.title}</div>
          {toast.message && <div className="toast-message">{toast.message}</div>}
        </div>
        <button
          type="button"
          className="toast-close"
          aria-label="Dismiss notification"
          onClick={() => dismissToast(toast.id)}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <div
        className="toast-progress"
        style={{ width: `${(remaining / DURATION_MS[toast.tone]) * 100}%` }}
      />
    </div>
  )
}

export function Toaster(): React.JSX.Element {
  const list = useSyncExternalStore(subscribeToasts, getToasts)
  return (
    <div className="toaster" aria-live="polite">
      {list.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}
