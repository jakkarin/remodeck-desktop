import { useEffect, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from 'cn'
import { CircleCheck, CircleX, X } from 'lucide-react'
import { useTransitionFor } from '../motion'
import { dismissToast, getToasts, subscribeToasts, type Toast } from '../toast'

// null = no auto-dismiss: error messages (e.g. git's rejection reason) stay until dismissed.
const DURATION_MS: Record<Toast['tone'], number | null> = { success: 4000, error: null }

function ToastItem({ toast, stacked }: { toast: Toast; stacked: boolean }): React.JSX.Element {
  // Hovering pauses the countdown so the toast can be read; the bar shows the time left.
  const [paused, setPaused] = useState(false)
  const [remaining, setRemaining] = useState(DURATION_MS[toast.tone] ?? 0)

  useEffect(() => {
    if (paused || DURATION_MS[toast.tone] === null) return
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
  const enter = useTransitionFor('enter')
  const exit = useTransitionFor('exit')
  const isError = toast.tone === 'error'
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0, scale: stacked ? 0.94 : 1, transition: enter }}
      exit={{ opacity: 0, x: 16, transition: exit }}
      className="pointer-events-auto relative overflow-hidden rounded-lg border border-border bg-background shadow-(--shadow-popover)"
      role={isError ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-start gap-2 p-3">
        <span
          className={cn(
            'mt-px grid size-6 flex-none place-items-center rounded-full',
            isError ? 'bg-destructive-soft text-destructive' : 'bg-success-soft text-success'
          )}
        >
          <Icon size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{toast.title}</div>
          {toast.message && (
            <div className="mt-0.5 text-xs break-words text-muted-foreground">{toast.message}</div>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss notification"
          className="grid size-6 flex-none place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => dismissToast(toast.id)}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {!isError && (
        <div
          className="absolute bottom-0 left-0 h-[3px] bg-success"
          style={{ width: `${(remaining / (DURATION_MS.success ?? 1)) * 100}%` }}
        />
      )}
    </motion.div>
  )
}

export function Toaster(): React.JSX.Element {
  const list = useSyncExternalStore(subscribeToasts, getToasts)
  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-200 flex w-[min(340px,calc(100vw-32px))] flex-col gap-2"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {list.map((t, i) => (
          <ToastItem key={t.id} toast={t} stacked={i < list.length - 1} />
        ))}
      </AnimatePresence>
    </div>
  )
}
