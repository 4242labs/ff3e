// Shape of GET /api/forecast.

export type ItemType = 'withdrawal' | 'deposit' | 'transfer'
export type ItemStatus = 'paid' | 'received' | 'done' | 'upcoming' | 'needs_review'
export type Granularity = 'day' | 'month' | 'year'

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
 * - outstanding:    everything still UNCONFIRMED due on/before today — reaches
 *                   back past this month to surface overdue.
 * - month_end:      the same, capped at the last day of the current month
 *                   (i.e. outstanding + what's still ahead this month).
 * The last two are not calendar periods: they're anchored to "now" and are
 * filtered to unconfirmed statuses only, so prev/next doesn't apply.
 */
export type ViewMode = 'day' | 'month' | 'year' | 'outstanding' | 'month_end'

/** Statuses that mean "hasn't happened / can't be confirmed yet". */
export const UNCONFIRMED_STATUSES: ItemStatus[] = ['upcoming', 'needs_review']

export function isCumulativeMode(mode: ViewMode): boolean {
  return mode === 'outstanding' || mode === 'month_end'
}
