// Persist the user's last view so Entropy resumes where they left off, rather
// than snapping back to "This month, no filters" on every reload. Theme and
// dashboard-visibility already persist under their own keys; this covers the
// remaining view state: mode, period anchor, and every active filter.
//
// localStorage-only, best-effort: a disabled/full store (private mode) silently
// falls back to session-only defaults — never throws into render.

import { EMPTY_FILTERS } from './filters'
import { shiftAnchor, todayISO } from './range'
import type { ActiveFilters, ReportPeriodMode, ReportView, ViewMode } from './types'

const KEY = 'entropy:viewstate'
const REPORTS_KEY = 'entropy:reports'
const MODES: ViewMode[] = ['day', 'month', 'year', 'outstanding', 'month_end']
const REPORT_PERIOD_MODES: ReportPeriodMode[] = ['day', 'month', 'year', 'custom']
const REPORT_VIEWS: ReportView[] = ['transactions', 'categories']
const ANCHOR_RE = /^\d{4}-\d{2}-\d{2}$/
const FACETS = ['type', 'category', 'account', 'currency'] as const

export interface ViewState {
  mode: ViewMode
  anchor: string
  filters: ActiveFilters
}

export function defaultViewState(): ViewState {
  return { mode: 'month', anchor: todayISO(), filters: EMPTY_FILTERS }
}

function isMode(x: unknown): x is ViewMode {
  return typeof x === 'string' && (MODES as string[]).includes(x)
}

// A stored filter set is only trusted if every facet is an array of strings;
// anything else (shape drift, tampering) falls back to "no filters". Individual
// values are NOT enum-validated here — the option universe is data-dependent
// (categories/accounts vary per fetch), so a value with no current match simply
// filters to nothing and the user clears it, rather than being silently dropped.
function sanitizeFilters(x: unknown): ActiveFilters {
  if (!x || typeof x !== 'object') return EMPTY_FILTERS
  const rec = x as Record<string, unknown>
  const out = { type: [], category: [], account: [], currency: [] } as unknown as ActiveFilters
  for (const f of FACETS) {
    const v = rec[f]
    if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) return EMPTY_FILTERS
    ;(out[f] as string[]) = [...(v as string[])]
  }
  return out
}

// A well-formed ISO day is honoured (resume where you were, even months back);
// anything malformed or unparseable clamps to today.
function sanitizeAnchor(x: unknown): string {
  if (typeof x === 'string' && ANCHOR_RE.test(x) && !Number.isNaN(Date.parse(x))) return x
  return todayISO()
}

export function loadViewState(): ViewState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultViewState()
    const p = JSON.parse(raw) as Record<string, unknown>
    return {
      mode: isMode(p.mode) ? p.mode : 'month',
      anchor: sanitizeAnchor(p.anchor),
      filters: sanitizeFilters(p.filters),
    }
  } catch {
    return defaultViewState()
  }
}

export function saveViewState(state: ViewState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* private mode / storage disabled — session-only is fine */
  }
}

// --- Reports -----------------------------------------------------------------
// Kept under its own key rather than folded into ViewState: the two pages have
// independent periods on purpose (reading last quarter's report should not move
// the forecast off this month), and a shared blob would couple them.

export interface ReportsState {
  periodMode: ReportPeriodMode
  anchor: string
  custom: { start: string; end: string }
  view: ReportView
  /** One card per calendar month instead of one per currency for the window. */
  groupByMonth: boolean
  filters: ActiveFilters
}

export function defaultReportsState(): ReportsState {
  const today = todayISO()
  return {
    periodMode: 'month',
    anchor: today,
    // A custom window nobody has touched yet opens on the last three months —
    // a defensible default for a report, and never an empty range.
    custom: { start: shiftAnchor('month', today, -2), end: today },
    view: 'transactions',
    groupByMonth: false,
    filters: EMPTY_FILTERS,
  }
}

function isReportPeriodMode(x: unknown): x is ReportPeriodMode {
  return typeof x === 'string' && (REPORT_PERIOD_MODES as string[]).includes(x)
}

function isReportView(x: unknown): x is ReportView {
  return typeof x === 'string' && (REPORT_VIEWS as string[]).includes(x)
}

function sanitizeCustom(x: unknown): { start: string; end: string } {
  const fallback = defaultReportsState().custom
  if (!x || typeof x !== 'object') return fallback
  const rec = x as Record<string, unknown>
  const start = typeof rec.start === 'string' && ANCHOR_RE.test(rec.start) ? rec.start : null
  const end = typeof rec.end === 'string' && ANCHOR_RE.test(rec.end) ? rec.end : null
  return start && end ? { start, end } : fallback
}

export function loadReportsState(): ReportsState {
  try {
    const raw = localStorage.getItem(REPORTS_KEY)
    if (!raw) return defaultReportsState()
    const p = JSON.parse(raw) as Record<string, unknown>
    const d = defaultReportsState()
    return {
      periodMode: isReportPeriodMode(p.periodMode) ? p.periodMode : d.periodMode,
      anchor: sanitizeAnchor(p.anchor),
      custom: sanitizeCustom(p.custom),
      view: isReportView(p.view) ? p.view : d.view,
      groupByMonth: typeof p.groupByMonth === 'boolean' ? p.groupByMonth : d.groupByMonth,
      filters: sanitizeFilters(p.filters),
    }
  } catch {
    return defaultReportsState()
  }
}

export function saveReportsState(state: ReportsState): void {
  try {
    localStorage.setItem(REPORTS_KEY, JSON.stringify(state))
  } catch {
    /* private mode / storage disabled — session-only is fine */
  }
}
