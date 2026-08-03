import { useCallback, useEffect, useMemo, useState } from 'react'

import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { LoadingSkeleton } from '@/components/LoadingSkeleton'
import { ReportChart, ReportFlowLegend } from '@/components/ReportChart'
import { ReportsNav } from '@/components/ReportsNav'
import { useTransactions } from '@/hooks/useTransactions'
import { customRangeLabel, periodLabel, reportRange, shiftAnchor, singlePeriodRange, todayISO } from '@/lib/range'
import {
  buildReport,
  filterTransactions,
  getTransactionFilterOptions,
  type Flow,
} from '@/lib/reports'
import { cn } from '@/lib/utils'
import { loadReportsState, saveReportsState } from '@/lib/viewstate'
import {
  isCustomPeriod,
  type ActiveFilters,
  type Granularity,
  type ReportPeriodMode,
  type ReportView,
} from '@/lib/types'

/**
 * Reports — the ledger, ranked.
 *
 * This reads BOOKED TRANSACTIONS (`/api/transactions`), not the forecast: it is
 * about what happened, where the forecast view is about what is coming. Period
 * sets the window, View sets what a bar means, and the body is one full-width
 * ranked card per currency — because totals never cross-sum ISO codes.
 */
export function ReportsPage() {
  const [persisted] = useState(loadReportsState)
  const [periodMode, setPeriodMode] = useState<ReportPeriodMode>(persisted.periodMode)
  const [anchor, setAnchor] = useState<string>(persisted.anchor)
  const [custom, setCustom] = useState(persisted.custom)
  const [view, setView] = useState<ReportView>(persisted.view)
  const [groupByMonth, setGroupByMonth] = useState(persisted.groupByMonth)
  const [groupBySeller, setGroupBySeller] = useState(persisted.groupBySeller)
  const [filters, setFilters] = useState<ActiveFilters>(persisted.filters)

  useEffect(() => {
    saveReportsState({
      periodMode,
      anchor,
      custom,
      view,
      groupByMonth,
      groupBySeller,
      filters,
    })
  }, [periodMode, anchor, custom, view, groupByMonth, groupBySeller, filters])

  const isCustom = isCustomPeriod(periodMode)

  // Both toggles are *intent*, held across the states where they do not apply —
  // a Month period, or a View that has already rolled up. Storing the intent and
  // masking it here means switching back restores what the user had set, rather
  // than silently clearing it behind a disabled control. The mask must match
  // ReportsNav's `perMonthInert` / `groupInert` exactly, or the header would
  // show a toggle the report is not honouring.
  const monthCards = groupByMonth && periodMode !== 'month'
  const sellerBars = groupBySeller && view === 'transactions'

  const range = useMemo(
    () => reportRange(periodMode, anchor, custom),
    [periodMode, anchor, custom],
  )
  const query = useMemo(() => ({ start: range.start, end: range.end }), [range.start, range.end])

  const { data, loading, error, refetch } = useTransactions(query)

  const label = useMemo(
    () => (isCustom ? customRangeLabel(custom) : periodLabel(periodMode as Granularity, anchor)),
    [isCustom, custom, periodMode, anchor],
  )

  const isCurrent = useMemo(() => {
    if (isCustom) return true
    const g = periodMode as Granularity
    return singlePeriodRange(g, anchor).start === singlePeriodRange(g, todayISO()).start
  }, [isCustom, periodMode, anchor])

  // Switching to a calendar period re-anchors to now, so the default is always
  // the current one rather than a month left over from a previous mode.
  const changePeriodMode = useCallback((m: ReportPeriodMode) => {
    setPeriodMode(m)
    if (m !== 'custom') setAnchor(todayISO())
  }, [])

  // Facet options come off the UNFILTERED window, so narrowing one facet never
  // shrinks another's list.
  const filterOptions = useMemo(
    () => (data ? getTransactionFilterOptions(data.transactions) : null),
    [data],
  )

  const report = useMemo(() => {
    if (!data) return []
    return buildReport(filterTransactions(data.transactions, filters), {
      view,
      groupByMonth: monthCards,
      groupBySeller: sellerBars,
    })
  }, [data, filters, view, monthCards, sellerBars])

  const flowsPresent = useMemo(() => {
    const seen = new Set<Flow>()
    for (const bucket of report) for (const row of bucket.rows) seen.add(row.flow)
    return [...seen]
  }, [report])

  return (
    <>
      <ReportsNav
        periodMode={periodMode}
        onPeriodModeChange={changePeriodMode}
        anchor={anchor}
        label={label}
        isCurrent={isCurrent}
        custom={custom}
        onCustomChange={setCustom}
        onPrev={() => setAnchor((a) => shiftAnchor(periodMode as Granularity, a, -1))}
        onNext={() => setAnchor((a) => shiftAnchor(periodMode as Granularity, a, 1))}
        onPick={setAnchor}
        onToday={() => setAnchor(todayISO())}
        view={view}
        onViewChange={setView}
        groupByMonth={groupByMonth}
        onGroupByMonthChange={setGroupByMonth}
        groupBySeller={groupBySeller}
        onGroupBySellerChange={setGroupBySeller}
        filterOptions={filterOptions}
        filters={filters}
        onFiltersChange={setFilters}
        onRefresh={refetch}
        loading={loading}
      />

      <main className="w-full max-w-7xl px-4 py-4 sm:px-6">
        {loading && !data && <LoadingSkeleton />}
        {error && !data && <ErrorState message={error} onRetry={refetch} />}

        {/* Keep the last-good report rendered (dimmed) across a period switch
            rather than tearing the subtree down — preserves each card's page. */}
        {data && (
          <div className={loading ? 'opacity-60 transition-opacity' : undefined}>
            {error && (
              <p className="mb-4 text-sm" style={{ color: 'var(--red)' }}>
                Refresh failed ({error}) — showing the last successful load.
              </p>
            )}

            {report.length === 0 ? (
              <EmptyState message="No transactions in this period." />
            ) : (
              <div className="space-y-4">
                {/* One card takes the whole row; more than one splits it in two
                    and wraps. Two is the ceiling: a third column starves the
                    label and the bar, and a report you cannot read the labels of
                    is not a report. */}
                <div
                  className={cn('grid gap-4', report.length > 1 ? 'md:grid-cols-2' : 'grid-cols-1')}
                >
                  {report.map((bucket) => (
                    <ReportChart key={bucket.key} data={bucket} />
                  ))}
                </div>
                <ReportFlowLegend flows={flowsPresent} />
              </div>
            )}
          </div>
        )}
      </main>
    </>
  )
}
