import { useReducedMotion, type Transition } from 'motion/react'

export type MotionKind = 'fast' | 'enter' | 'exit' | 'layout'

/** Seconds. The single source of animation durations for the renderer. */
export const DURATION: Record<MotionKind, number> = {
  fast: 0.12,
  enter: 0.18,
  exit: 0.12,
  layout: 0.22
}

const TRANSITIONS: Record<MotionKind, Transition> = {
  fast: { duration: DURATION.fast, ease: 'easeOut' },
  enter: { type: 'spring', stiffness: 520, damping: 40 },
  exit: { duration: DURATION.exit, ease: 'easeIn' },
  layout: { type: 'spring', stiffness: 400, damping: 36 }
}

/**
 * Transition for a motion kind. With reduced motion, transforms snap
 * instantly and only opacity keeps a short 80 ms fade.
 */
export function transitionFor(kind: MotionKind, reduced: boolean): Transition {
  if (reduced) return { duration: 0, opacity: { duration: 0.08 } }
  return TRANSITIONS[kind]
}

/** Hook form of transitionFor that reads the OS reduced-motion setting. */
export function useTransitionFor(kind: MotionKind): Transition {
  return transitionFor(kind, useReducedMotion() ?? false)
}

/** Shared enter/exit pose for dialogs and popovers. */
export const dialogMotion = {
  initial: { opacity: 0, scale: 0.96, y: 6 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.96, y: 6 }
}
