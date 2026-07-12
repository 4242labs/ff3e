import { cn } from '@/lib/utils'

/**
 * The "FF3E" wordmark as an SVG (crisp at any size), set in the heading face
 * Space Grotesk. The viewBox is the measured glyph run at font-size 100 (width
 * 219, cap height 70 — all caps, no descender), so the box IS the letterforms:
 * the mark aligns optically with the asterisk beside it with no stray padding.
 * `fill=currentColor` → colour it via `text-*`. Display size is driven by the
 * CSS height; width auto-scales.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <svg
      className={cn('w-auto', className)}
      viewBox="0 0 219 70"
      fill="currentColor"
      role="img"
      aria-label="FF3 Entropy"
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="0"
        y="70"
        fontFamily="var(--font-heading), 'Space Grotesk', system-ui, sans-serif"
        fontSize="100"
        fontWeight="600"
        letterSpacing="-1.5"
      >
        FF3E
      </text>
    </svg>
  )
}
