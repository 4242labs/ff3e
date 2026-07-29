import { useEffect, useMemo, useState } from 'react'

import { AppSidebar } from '@/components/AppSidebar'
import { PeriodNav } from '@/components/PeriodNav'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { SummaryCards } from '@/components/SummaryCards'
import { BreakdownPie } from '@/components/BreakdownPie'
import { CashFlowTrend } from '@/components/CashFlowTrend'
import { OverdueAging } from '@/components/OverdueAging'
import { PeriodBar } from '@/components/PeriodBar'
import { PeriodTable } from '@/components/PeriodTable'
import { LoadingSkeleton } from '@/components/LoadingSkeleton'
import { ErrorState } from '@/components/ErrorState'
import { EmptyState } from '@/components/EmptyState'
import { useProjections } from '@/hooks/useProjections'
import { applyFilters, countNeedsReview, getFilterOptions, sortPeriods } from '@/lib/filters'
import { formatDate } from '@/lib/format'
import { periodLabel, rangeForMode, shiftAnchor, singlePeriodRange, todayISO } from '@/lib/range'
import { loadViewState, saveViewState } from '@/lib/viewstate'
import {
  isCumulativeMode,
  type ActiveFilters,
  type DashboardMode,
  type Granularity,
  type ViewMode,
} from '@/lib/types'

const DASHBOARD_MODE_KEY = 'entropy:dashboard'

// Reads the legacy boolean ('shown' | 'hidden') alongside the current enum, so
// an existing user's last choice carries over instead of resetting to the
// default. 'hidden' meant "table only", which is what 'data' mode is now.
function loadDashboardMode(): DashboardMode {
  try {
    const stored = localStorage.getItem(DASHBOARD_MODE_KEY)
    return stored === 'hidden' || stored === 'data' ? 'data' : 'dashboard'
  } catch {
    return 'dashboard'
  }
}

export default function App() {
  // Resume the last view (mode / period / filters) rather than resetting to
  // defaults on every load. Read once, lazily, on mount.
  const [persisted] = useState(loadViewState)
  const [mode, setMode] = useState<ViewMode>(persisted.mode)
  const [anchor, setAnchor] = useState<string>(persisted.anchor)
  const [filters, setFilters] = useState<ActiveFilters>(persisted.filters)
  // Persist any change to the view so the next load resumes from it.
  useEffect(() => {
    saveViewState({ mode, anchor, filters })
  }, [mode, anchor, filters])
  // Dashboard mode (stat cards + charts) vs data mode (the item table) —
  // mutually exclusive, never both. Defaults to dashboard; the choice persists
  // across reloads.
  const [dashboardMode, setDashboardMode] = useState<DashboardMode>(loadDashboardMode)
  const changeDashboardMode = (next: DashboardMode) => {
    setDashboardMode(next)
    try {
      localStorage.setItem(DASHBOARD_MODE_KEY, next)
    } catch {
      /* private mode / storage disabled — session-only toggle is fine */
    }
  }

  // Data-table-only: which asset account(s) collapse into a subtotal row per
  // period instead of one row per item. Independent of the Account filter —
  // its options are every asset account in the dataset, not just whatever's
  // currently selected in Account — so grouping a card, say, doesn't require
  // also narrowing the item list down to just that card.
  const [groupAccounts, setGroupAccounts] = useState<string[]>([])

  const cumulative = isCumulativeMode(mode)

  // Calendar modes fetch exactly one day/month/year; the cumulative modes fetch
  // the 12-month overdue window capped at today / month-end.
  const query = useMemo(() => rangeForMode(mode, anchor), [mode, anchor])

  const { data, loading, error, refetch } = useProjections(query)

  const label = useMemo(
    () =>
      cumulative
        ? `through ${formatDate(query.end)}`
        : periodLabel(mode as Granularity, anchor),
    [cumulative, query.end, mode, anchor],
  )

  const isCurrent = useMemo(() => {
    if (cumulative) return true
    const g = mode as Granularity
    return singlePeriodRange(g, anchor).start === singlePeriodRange(g, todayISO()).start
  }, [cumulative, mode, anchor])

  // Switching to a calendar mode re-anchors to the current period, so the
  // default is always "now" rather than a stale 1st-of-some-month.
  const changeMode = (m: ViewMode) => {
    setMode(m)
    if (!isCumulativeMode(m)) setAnchor(todayISO())
  }

  const filterOptions = useMemo(() => (data ? getFilterOptions(data) : null), [data])
  // Cumulative views show ONLY unconfirmed (Upcoming + Needs-review) items.
  const filtered = useMemo(
    () => (data ? applyFilters(data, filters, cumulative) : null),
    [data, filters, cumulative],
  )
  const sortedFilteredPeriods = useMemo(
    () => (filtered ? sortPeriods(filtered.periods) : []),
    [filtered],
  )
  const availableCurrencies = useMemo(
    () => (filtered ? Object.keys(filtered.currencies).sort((a, b) => a.localeCompare(b)) : []),
    [filtered],
  )
  const needsReviewCount = useMemo(() => (data ? countNeedsReview(data) : 0), [data])

  const emptyMessage = cumulative
    ? mode === 'outstanding'
      ? 'Nothing overdue — everything due so far is accounted for.'
      : 'Nothing due through the end of this month.'
    : 'No projected obligations in this period.'

  return (
    <SidebarProvider>
      <AppSidebar activeView="forecast" />
      <SidebarInset>
        <PeriodNav
          mode={mode}
          onModeChange={changeMode}
          anchor={anchor}
          label={label}
          isCurrent={isCurrent}
          onPrev={() => setAnchor((a) => shiftAnchor(mode as Granularity, a, -1))}
          onNext={() => setAnchor((a) => shiftAnchor(mode as Granularity, a, 1))}
          onPick={setAnchor}
          onToday={() => setAnchor(todayISO())}
          onRefresh={refetch}
          loading={loading}
          needsReviewCount={needsReviewCount}
          filterOptions={filterOptions}
          filters={filters}
          onFiltersChange={setFilters}
          dashboardMode={dashboardMode}
          onDashboardModeChange={changeDashboardMode}
          groupAccounts={groupAccounts}
          onGroupAccountsChange={setGroupAccounts}
        />

        <main className="w-full max-w-7xl px-4 py-4 sm:px-6">
          {loading && !data && <LoadingSkeleton />}
          {error && !data && <ErrorState message={error} onRetry={refetch} />}

          {/* Keep the last-good data rendered (dimmed) across a mode switch /
              refresh rather than tearing down the whole subtree — preserves
              each chart's local currency/group-by selection. */}
          {data && filtered && (
            <div className={loading ? 'opacity-60 transition-opacity' : undefined}>
              {error && (
                <p className="mb-4 text-sm" style={{ color: 'var(--red)' }}>
                  Refresh failed ({error}) — showing the last successful load.
                </p>
              )}

              <div className="space-y-4">
                {filtered.meta.item_count === 0 ? (
                  <EmptyState message={emptyMessage} />
                ) : (
                  <>
                    {dashboardMode === 'dashboard' ? (
                      <>
                        <SummaryCards currencies={filtered.currencies} />

                        {/* Exploratory round: chart candidates relevant to
                            the Outstanding & upcoming forecast, three per
                            row, so they can be compared side by side before
                            deciding which stay. Each has its own expand
                            button (top right) for a closer look.

                            Currency is driven entirely by the header's
                            Currency filter (no per-chart picker): each
                            currency-sensitive chart renders one instance per
                            currency in `availableCurrencies`, so selecting
                            two currencies up top shows two of each chart. */}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                          {availableCurrencies.map((cur) => (
                            <PeriodBar
                              key={`iof-${cur}`}
                              periods={sortedFilteredPeriods}
                              currency={cur}
                              showCurrencyInTitle={availableCurrencies.length > 1}
                            />
                          ))}
                          {availableCurrencies.map((cur) => (
                            <CashFlowTrend
                              key={`cashflow-${cur}`}
                              periods={sortedFilteredPeriods}
                              currency={cur}
                              showCurrencyInTitle={availableCurrencies.length > 1}
                            />
                          ))}
                          <OverdueAging periods={sortedFilteredPeriods} />
                          {availableCurrencies.map((cur) => (
                            <BreakdownPie
                              key={`category-${cur}`}
                              groupBy="category"
                              periods={sortedFilteredPeriods}
                              currency={cur}
                              showCurrencyInTitle={availableCurrencies.length > 1}
                            />
                          ))}
                          {availableCurrencies.map((cur) => (
                            <BreakdownPie
                              key={`account-${cur}`}
                              groupBy="account"
                              periods={sortedFilteredPeriods}
                              currency={cur}
                              showCurrencyInTitle={availableCurrencies.length > 1}
                            />
                          ))}
                          {availableCurrencies.map((cur) => (
                            <BreakdownPie
                              key={`payee-${cur}`}
                              groupBy="payee"
                              periods={sortedFilteredPeriods}
                              currency={cur}
                              showCurrencyInTitle={availableCurrencies.length > 1}
                            />
                          ))}
                        </div>
                      </>
                    ) : (
                      <PeriodTable periods={sortedFilteredPeriods} groupAccounts={groupAccounts} />
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
