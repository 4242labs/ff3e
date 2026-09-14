import { cn } from '@/lib/utils'
import type { ItemStatus } from '@/lib/types'

const LABEL: Record<ItemStatus, string> = {
  upcoming: 'Upcoming',
  paid: 'Paid',
  received: 'Received',
  done: 'Done',
  needs_review: 'Needs review',
  acknowledged_gap: 'Acknowledged',
}

const STATUS: Record<ItemStatus, 'success' | 'info' | 'warning' | 'neutral'> = {
  upcoming: 'neutral',
  paid: 'success',
  received: 'success',
  done: 'info',
  needs_review: 'warning',
  acknowledged_gap: 'neutral',
}

export function StatusBadge({ status, className }: { status: ItemStatus; className?: string }) {
  return <span className={cn('marker', className)} data-status={STATUS[status]}>{LABEL[status]}</span>
}
