import { useId } from 'react'

// Magic UI dot-pattern at ornament opacity, masked to a corner.
export function DotPattern({ className }: { className?: string }) {
  const id = useId()
  return (
    <svg className={`dots ${className ?? ''}`} aria-hidden>
      <defs>
        <pattern id={id} width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.1" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}
