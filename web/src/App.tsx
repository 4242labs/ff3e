import { useEffect, useMemo, useState } from 'react'

import { AppSidebar } from '@/components/AppSidebar'
import { PeriodNav } from '@/components/PeriodNav'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { SummaryCards } from '@/components/SummaryCards'
import { CategoryPie } from '@/components/CategoryPie'
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
import { isCumulativeMode, type ActiveFilters, type Granularity, type ViewMode } from '@/lib/types'

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
  // Dashboard = the stat cards + charts. Shown by default; the choice persists
  // across reloads. The item list below is never gated by this.
  const [dashboardShown, setDashboardShown] = useState<boolean>(() => {
    try {
      return localStorage.getItem('entropy:dashboard') !== 'hidden'
    } catch {
      return true
    }
  })
  const toggleDashboard = () =>
    setDashboardShown((shown) => {
      const next = !shown
      try {
        localStorage.setItem('entropy:dashboard', next ? 'shown' : 'hidden')
      } catch {
        /* private mode / storage disabled — session-only toggle is fine */
      }
      return next
    })

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
          dashboardShown={dashboardShown}
          onToggleDashboard={toggleDashboard}
        />

        <main className="w-full max-w-[1280px] px-4 py-6 sm:px-6">
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

              <div className="space-y-6">
                {filtered.meta.item_count === 0 ? (
                  <EmptyState message={emptyMessage} />
                ) : (
                  <>
                    {dashboardShown && (
                      <>
                        <SummaryCards currencies={filtered.currencies} />

                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                          <CategoryPie
                            periods={sortedFilteredPeriods}
                            availableCurrencies={availableCurrencies}
                          />
                          <PeriodBar
                            periods={sortedFilteredPeriods}
                            availableCurrencies={availableCurrencies}
                          />
                        </div>
                      </>
                    )}

                    <PeriodTable periods={sortedFilteredPeriods} />
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
