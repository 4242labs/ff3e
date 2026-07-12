import type { ItemStatus } from './types'

/**
 * Fixed categorical chart ramp — raw-palette vars, cycled
 * if there are more than 10 series. Passed straight to Recharts as
 * `fill="var(--orange-500)"` etc. so colours track the
 * the token layer at runtime instead of baking in literals.
 */
export const CATEGORICAL_RAMP = [
  'var(--orange-500)',
  'var(--blue)',
  'var(--emerald)',
  'var(--amber)',
  'var(--red)',
  'var(--orange-300)',
  'var(--blue-dark)',
  'var(--emerald-dark)',
  'var(--amber-dark)',
  'var(--warm-500)',
] as const

export function colorForIndex(i: number): string {
  return CATEGORICAL_RAMP[i % CATEGORICAL_RAMP.length]
}

/** Status colours: paid/done -> emerald, received -> blue,
 * upcoming -> fg-muted, needs_review -> amber (distinct/warning). */
export const STATUS_COLOR: Record<ItemStatus, string> = {
  paid: 'var(--emerald)',
  done: 'var(--emerald)',
  received: 'var(--blue)',
  upcoming: 'var(--fg-muted)',
  needs_review: 'var(--amber)',
}

export const STATUS_LABEL: Record<ItemStatus, string> = {
  paid: 'Paid',
  done: 'Done',
  received: 'Received',
  upcoming: 'Upcoming',
  needs_review: 'Needs review',
}
