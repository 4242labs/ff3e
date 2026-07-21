// Persist the user's last view so Entropy resumes where they left off, rather
// than snapping back to "This month, no filters" on every reload. Theme and
// dashboard-visibility already persist under their own keys; this covers the
// remaining view state: mode, period anchor, and every active filter.
//
// localStorage-only, best-effort: a disabled/full store (private mode) silently
// falls back to session-only defaults — never throws into render.

import { EMPTY_FILTERS } from './filters'
import { todayISO } from './range'
import type { ActiveFilters, ViewMode } from './types'

const KEY = 'entropy:viewstate'
const MODES: ViewMode[] = ['day', 'month', 'year', 'outstanding', 'month_end']
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
// anything else (shape drift, tampering) falls back to "no filters".
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
