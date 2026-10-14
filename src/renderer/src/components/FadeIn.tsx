import { motion } from 'motion/react'
import { useTransitionFor } from '../motion'

/**
 * Opacity-only fade on mount, used for the content a module swaps in.
 * Never wrap the terminal dock in this: it must stay mounted and fully opaque.
 */
export function FadeIn({
  className,
  children
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <motion.div
      data-fade-in=""
      className={className}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={useTransitionFor('fast')}
    >
      {children}
    </motion.div>
  )
}
