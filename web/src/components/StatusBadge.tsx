import type { ItemStatus } from '@/lib/types'
import { STATUS_COLOR, STATUS_LABEL } from '@/lib/colors'
import { cn } from '@/lib/utils'

/**
 * Colour-by-status badge. Token-driven only — no raw hex.
 * Design decision:
 * paid/done/received are routine outcomes and get a solid fill; upcoming is
 * quiet (soft/outline); needs_review must read as a warning, so it gets a
 * soft warm fill with solid-coloured text/border rather than a full solid
 * block (better contrast, still unmistakably distinct).
 */
export function StatusBadge({ status, className }: { status: ItemStatus; className?: string }) {
  const color = STATUS_COLOR[status]
  const label = STATUS_LABEL[status]

  if (status === 'paid' || status === 'done' || status === 'received') {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold text-[var(--warm-0)]',
          className,
        )}
        style={{ backgroundColor: color }}
      >
        {label}
      </span>
    )
  }

  return (
    <span
      className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold', className)}
      style={{
        color,
        borderColor: color,
        // `bg-[--amber]/15` (Tailwind's opacity modifier on the CSS-var
        // arbitrary-value shorthand) silently emits no CSS in this
        // Tailwind version — verified against the built stylesheet — so
        // the tint is done directly with color-mix() instead. Still a
        // token reference, zero raw hex.
        backgroundColor:
          status === 'needs_review' ? 'color-mix(in srgb, var(--amber) 15%, transparent)' : undefined,
      }}
    >
      {label}
    </span>
  )
}
