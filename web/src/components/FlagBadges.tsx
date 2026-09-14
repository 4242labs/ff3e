import { cn } from '@/lib/utils'

export function FlagBadges({ flags, className }: { flags?: string[]; className?: string }) {
  if (!flags?.length) return null
  return (
    <span className={cn('inline-flex flex-wrap gap-2', className)}>
      {flags.map((flag) => <span key={flag} className="marker" data-status="error">{flag.split('_').join(' ')}</span>)}
    </span>
  )
}
