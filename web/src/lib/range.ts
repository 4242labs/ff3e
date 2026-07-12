import type { Granularity, ViewMode } from './types'

/** How far back the cumulative views (Outstanding / Due by Month-End) look for
 * still-unconfirmed obligations. The engine needs a bounded start date; 12
 * months comfortably covers real overdue while keeping the payload sane. */
export const OVERDUE_LOOKBACK_MONTHS = 12

/** Local-calendar-date 'YYYY-MM-DD'. Deliberately NOT `toISOString().slice(0,10)`
 * (that reads UTC fields) — all date math here is local `getFullYear/Month/Date`
 * so a viewer in a negative-UTC-offset zone never sees the anchor roll a day. */
function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parse(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m, d }
}

/** Date -> local ISO 'YYYY-MM-DD' (for the pickers). */
export function toISO(d: Date): string {
  return isoDate(d)
}

/** Anchor ISO -> a local Date (for the pickers). */
export function anchorToDate(anchor: string): Date {
  const { y, m, d } = parse(anchor)
  return new Date(y, m - 1, d)
}

export interface RangeQuery {
  granularity: Granularity
  start: string
  end: string
}

/** Today as a local ISO date — the default anchor (the "current" period). */
export function todayISO(today: Date = new Date()): string {
  return isoDate(today)
}

/**
 * The single period containing `anchor`, as a start/end window the engine can
 * serve (day/month/year show ONE period at a time, not a stacked
 * range). Day → that day; Month → 1st…last of its month; Year → Jan 1…Dec 31.
 */
export function singlePeriodRange(granularity: Granularity, anchor: string): RangeQuery {
  const { y, m, d } = parse(anchor)
  switch (granularity) {
    case 'day':
      return { granularity, start: anchor, end: anchor }
    case 'year':
      return { granularity, start: `${y}-01-01`, end: `${y}-12-31` }
    case 'month':
    default: {
      const start = `${y}-${String(m).padStart(2, '0')}-01`
      const lastDay = new Date(y, m, 0).getDate() // day 0 of next month = last of this
      const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
      void d
      return { granularity, start, end }
    }
  }
}

/** Move the anchor `delta` periods (prev/next). Result is normalised to the
 * period start (1st of month / Jan 1) except day, which keeps the exact day. */
export function shiftAnchor(granularity: Granularity, anchor: string, delta: number): string {
  const { y, m, d } = parse(anchor)
  switch (granularity) {
    case 'day':
      return isoDate(new Date(y, m - 1, d + delta))
    case 'year':
      return isoDate(new Date(y + delta, 0, 1))
    case 'month':
    default:
      return isoDate(new Date(y, m - 1 + delta, 1))
  }
}

/**
 * Range for the cumulative views. Both start at the lookback floor (so
 * prior-month overdue is included — the whole point) and differ only in where
 * they stop: `outstanding` at today, `month_end` at the last day of this
 * month. Bucketed by month so the table groups overdue by the month it slipped.
 * The unconfirmed-only filter is applied client-side (see filters.ts).
 */
export function cumulativeRange(
  mode: 'outstanding' | 'month_end',
  today: Date = new Date(),
): RangeQuery {
  const y = today.getFullYear()
  const m = today.getMonth() // 0-based
  const floor = new Date(y, m - OVERDUE_LOOKBACK_MONTHS, 1)
  const end =
    mode === 'outstanding'
      ? today
      : new Date(y, m + 1, 0) // day 0 of next month = last day of this month
  return { granularity: 'month', start: isoDate(floor), end: isoDate(end) }
}

/** The window to fetch for any view mode. */
export function rangeForMode(mode: ViewMode, anchor: string, today: Date = new Date()): RangeQuery {
  if (mode === 'outstanding' || mode === 'month_end') return cumulativeRange(mode, today)
  return singlePeriodRange(mode, anchor)
}

// 3-letter month (not "July") so the Month field is compact and — since every
// abbreviation is the same width — doesn't resize as you page through months.
const _monthYear = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' })
const _dayLabel = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** Human label for the current single period: "Jul 12, 2026" / "Jul 2026" / "2026". */
export function periodLabel(granularity: Granularity, anchor: string): string {
  const { y, m, d } = parse(anchor)
  const date = new Date(y, m - 1, d)
  switch (granularity) {
    case 'day':
      return _dayLabel.format(date)
    case 'year':
      return String(y)
    case 'month':
    default:
      return _monthYear.format(date)
  }
}
