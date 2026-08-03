import { CalendarRange, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { DateRangePicker } from '@/components/DateRangePicker'
import { FacetedFilter } from '@/components/FacetedFilter'
import { FilterBar } from '@/components/FilterBar'
import { PeriodPicker } from '@/components/PeriodPicker'
import type { FilterOptions } from '@/lib/filters'
import { cn } from '@/lib/utils'
import {
  isCustomPeriod,
  type ActiveFilters,
  type Granularity,
  type ReportPeriodMode,
  type ReportView,
} from '@/lib/types'

// Named "Period", not "View": on Reports the timeframe is not what you are
// looking at — the View filter is. Same control, same options as Outstanding &
// Upcoming's calendar modes, plus the custom window that only Reports has.
const PERIOD_OPTIONS: { value: ReportPeriodMode; label: string; short?: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'custom', label: 'Custom range', short: 'Custom' },
]

// What one bar means. Both read the same booked transactions; they differ only
// in whether each transaction gets its own bar or is rolled into its category.
const VIEW_OPTIONS: { value: ReportView; label: string }[] = [
  { value: 'transactions', label: 'Transactions' },
  { value: 'categories', label: 'Categories' },
]

export interface ReportsNavProps {
  periodMode: ReportPeriodMode
  onPeriodModeChange: (m: ReportPeriodMode) => void
  anchor: string
  /** The period caption for the calendar modes ("Jul 2026"). */
  label: string
  isCurrent: boolean
  custom: { start: string; end: string }
  onCustomChange: (range: { start: string; end: string }) => void
  onPrev: () => void
  onNext: () => void
  onPick: (iso: string) => void
  onToday: () => void
  view: ReportView
  onViewChange: (v: ReportView) => void
  /** One card per calendar month, instead of one per currency for the window. */
  groupByMonth: boolean
  onGroupByMonthChange: (on: boolean) => void
  filterOptions: FilterOptions | null
  filters: ActiveFilters
  onFiltersChange: (f: ActiveFilters) => void
  onRefresh: () => void
  loading: boolean
}

/**
 * The Reports header — the same single bar Outstanding & Upcoming uses, with
 * the same affordances in the same places, so moving between the two pages
 * costs no relearning. Left: Period (what window) and its navigator. Right: the
 * data facets (how you are narrowing it) and refresh. View sits with Period,
 * because together they define what the report IS.
 */
export function ReportsNav(props: ReportsNavProps) {
  const {
    periodMode,
    onPeriodModeChange,
    anchor,
    label,
    isCurrent,
    custom,
    onCustomChange,
    onPrev,
    onNext,
    onPick,
    onToday,
    view,
    onViewChange,
    groupByMonth,
    onGroupByMonthChange,
    filterOptions,
    filters,
    onFiltersChange,
    onRefresh,
    loading,
  } = props

  const isCustom = isCustomPeriod(periodMode)

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex w-full max-w-7xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />

        <FacetedFilter
          title="Period"
          single
          options={PERIOD_OPTIONS}
          selected={[periodMode]}
          onChange={([v]) => onPeriodModeChange(v as ReportPeriodMode)}
        />

        {isCustom ? (
          <DateRangePicker start={custom.start} end={custom.end} onChange={onCustomChange} />
        ) : (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={onPrev}
              aria-label="Previous period"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <PeriodPicker
              granularity={periodMode as Granularity}
              anchor={anchor}
              label={label}
              isCurrent={isCurrent}
              onPick={onPick}
              onToday={onToday}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={onNext}
              aria-label="Next period"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />

        <FacetedFilter
          title="View"
          single
          options={VIEW_OPTIONS}
          selected={[view]}
          onChange={([v]) => onViewChange(v as ReportView)}
        />

        <Button
          variant="outline"
          size="sm"
          className={cn('h-8', groupByMonth && 'bg-secondary text-secondary-foreground')}
          onClick={() => onGroupByMonthChange(!groupByMonth)}
          aria-pressed={groupByMonth}
          title="One card per calendar month"
        >
          <CalendarRange className="mr-2 h-4 w-4" />
          Per month
        </Button>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {filterOptions && (
            <FilterBar options={filterOptions} filters={filters} onChange={onFiltersChange} />
          )}
          <Button
            variant="outline"
            size="icon"
            className={cn('h-8 w-8')}
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>
    </header>
  )
}
