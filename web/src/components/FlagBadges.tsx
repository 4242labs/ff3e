import { FLAG_LABEL } from '@/lib/colors'
import { cn } from '@/lib/utils'

/**
 * Per-occurrence engine flags — conditions the forecast engine surfaced but
 * deliberately refused to guess through (missing tag key, duplicate key,
 * conflicting settlement, non-monthly, unknown billing cycle). Rendered as small
 * red-outline chips so a problem row reads as "needs attention", distinct from a
 * plain needs_review. Nothing renders when the occurrence is clean.
 */
export function FlagBadges({ flags, className }: { flags?: string[]; className?: string }) {
  if (!flags || flags.length === 0) return null
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {flags.map((f) => (
        <span
          key={f}
          className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em]"
          style={{
            color: 'var(--red)',
            borderColor: 'var(--red)',
            backgroundColor: 'color-mix(in srgb, var(--red) 12%, transparent)',
          }}
          title={FLAG_LABEL[f] ?? f}
        >
          {FLAG_LABEL[f] ?? f}
        </span>
      ))}
    </span>
  )
}
