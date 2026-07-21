// Shape of GET /api/forecast.

export type ItemType = 'withdrawal' | 'deposit' | 'transfer'
// NOTE: against a live Firefly III the engine emits only the OUTSTANDING set
// (upcoming + needs_review + acknowledged_gap) — a confirmed occurrence lives in
// Firefly III and is dropped at the source. paid/received/done remain in the union
// because the local dev fixture (fixtures/projections-wide.json) still exercises
// them. acknowledged_gap = a month knowingly accepted as unpaid (a deliberate
// skip): kept visible so it is auditable, but distinct from needs_review.
export type ItemStatus =
  | 'paid'
  | 'received'
  | 'done'
  | 'upcoming'
  | 'needs_review'
  | 'acknowledged_gap'
export type Granularity = 'day' | 'month' | 'year'

// How an occurrence is settled: `tag` = Mechanism A (explicit settles:<slug>:<M>
// tag on the transaction); `fatura` = Mechanism B (credit-card installment cleared
// by its billing cycle). Drives whether the installment N/T count is shown.
export type Mechanism = 'tag' | 'fatura'

export interface ProjectionItem {
  date: string
  title: string
  type: ItemType
  amount: number
  currency: string
  source: string | null
  destination: string | null
  category: string | null
  status: ItemStatus
  matched_txn_id: string | null
  mechanism: Mechanism
  // Installments still unpaid across the whole finite series; null for an
  // open-ended commitment. (Engine: window-independent.)
  remaining: number | null
  // This occurrence's 1-based position in a finite installment series and the
  // series total, so the row can read "N/T" (e.g. 3/10). Both null for an
  // open-ended commitment.
  installment_no: number | null
  installment_total: number | null
  // Per-occurrence problems the engine surfaced but refused to guess through
  // (missing_slug / non_monthly / duplicate_slug / settled_conflict /
  // cycle_unknown). Absent when the occurrence is clean.
  flags?: string[]
}

export interface CurrencyTotals {
  out?: number
  in?: number
  xfer?: number
  net?: number
}

export interface Period {
  key: string
  label: string
  items: ProjectionItem[]
  totals: Record<string, CurrencyTotals>
  status_counts: Partial<Record<ItemStatus, number>>
}

export interface ProjectionsResponse {
  range: { start: string; end: string; granularity: Granularity }
  filters: {
    type: string | null
    category: string | null
    account: string | null
    currency: string | null
  }
  currencies: Record<string, { out: number; in: number; net: number }>
  periods: Period[]
  meta: {
    recurrences_total: number
    active: number
    match_window_days: number
    item_count: number
  }
}

// Client-side filter state — never sent to the server.
// Multi-select (faceted) — an empty array means "no constraint on this facet".
export interface ActiveFilters {
  type: ItemType[]
  category: string[]
  account: string[]
  currency: string[]
}

export type PieGroupBy = 'category' | 'account' | 'payee'

/**
 * What the view is showing.
 * - day/month/year: ONE calendar period at a time, navigable (default: current).
 * - outstanding:    (labelled "Overdue") everything still UNCONFIRMED due
 *                   on/before today — reaches back past this month.
 * - month_end:      (labelled "Due this month") the same, capped at the last
 *                   day of the current month (overdue + what's still ahead this
 *                   month).
 * The last two are not calendar periods: they're anchored to "now" and are
 * filtered to unconfirmed statuses only, so prev/next doesn't apply.
 */
export type ViewMode = 'day' | 'month' | 'year' | 'outstanding' | 'month_end'

/** Statuses that mean "not settled" — shown on the cumulative Overdue /
 * Due-this-month triage views. acknowledged_gap is included so a knowingly-unpaid
 * month stays auditable there rather than vanishing from the triage surface. */
export const UNCONFIRMED_STATUSES: ItemStatus[] = [
  'upcoming',
  'needs_review',
  'acknowledged_gap',
]

export function isCumulativeMode(mode: ViewMode): boolean {
  return mode === 'outstanding' || mode === 'month_end'
}
