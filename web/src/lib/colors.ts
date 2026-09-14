import type { ItemStatus } from './types'

/**
 * Fixed categorical chart ramp — semantic roles, cycled
 * if there are more than 10 series. Passed straight to Recharts as
 * `fill="var(--accent-solid)"` etc. so colours track the
 * the token layer at runtime instead of baking in literals.
 */
export const CATEGORICAL_RAMP = [
  'var(--accent-solid)',
  'var(--fg)',
  'var(--link)',
  'var(--fg-2)',
  'var(--logo)',
  'var(--border-control)',
  'var(--accent-hover)',
  'var(--fg-muted)',
] as const

export function colorForIndex(i: number): string {
  return CATEGORICAL_RAMP[i % CATEGORICAL_RAMP.length]
}

/** Status colours: paid/done -> emerald, received -> blue,
 * upcoming -> fg-muted, needs_review -> amber (distinct/warning),
 * acknowledged_gap -> fg-muted (quiet; the badge uses a dashed border to set it
 * apart from upcoming — a knowingly-skipped month is not alarming). */
export const STATUS_COLOR: Record<ItemStatus, string> = {
  paid: 'var(--status-success)',
  done: 'var(--status-success)',
  received: 'var(--status-info)',
  upcoming: 'var(--fg-muted)',
  needs_review: 'var(--status-warning)',
  acknowledged_gap: 'var(--fg-muted)',
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  paid: 'Paid',
  done: 'Done',
  received: 'Received',
  upcoming: 'Upcoming',
  needs_review: 'Needs review',
  acknowledged_gap: 'Accepted gap',
}

/** Human labels for the per-occurrence engine flags (problems it surfaced but
 * refused to guess through). Unknown codes fall back to the raw code. */
export const FLAG_LABEL: Record<string, string> = {
  missing_slug: 'No tag key',
  non_monthly: 'Not monthly',
  duplicate_slug: 'Duplicate key',
  settled_conflict: 'Settlement conflict',
  cycle_unknown: 'Cycle unknown',
}
