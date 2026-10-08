export type ToastTone = 'success' | 'error'

export type Toast = { id: number; tone: ToastTone; title: string; message?: string }

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function subscribeToasts(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function getToasts(): Toast[] {
  return toasts
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

/** Shows a transient notification in the bottom-right corner; callable from anywhere. */
export function showToast(title: string, opts: { tone?: ToastTone; message?: string } = {}): void {
  toasts = [...toasts, { id: nextId++, tone: opts.tone ?? 'success', title, message: opts.message }]
  emit()
}
