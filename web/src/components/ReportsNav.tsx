import { CalendarRange, ChevronLeft, ChevronRight, Group, RefreshCw } from 'lucide-react'

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

// What one bar means. All three read the same booked transactions; they differ
// only in what each transaction is collapsed onto — itself, its category, or the
// account of the user's own that it moved through.
const VIEW_OPTIONS: { value: ReportView; label: string }[] = [
  { value: 'transactions', label: 'Transactions' },
  { value: 'categories', label: 'Categories' },
  { value: 'accounts', label: 'Accounts' },
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
  /** One bar per seller, instead of one per transaction. */
  groupBySeller: boolean
  onGroupBySellerChange: (on: boolean) => void
  filterOptions: FilterOptions | null
  filters: ActiveFilters
  onFiltersChange: (f: ActiveFilters) => void
  onRefresh: () => void
  loading: boolean
}

/**
 * The Reports header — the same single bar Outstanding & Upcoming uses, with
 * the same affordances in the same places, so moving between the two pages
 * costs no relearning.
 *
 * Two runs, split by whitespace rather than a rule. Left: Period and its
 * navigator — WHICH WINDOW you are looking at. Right, flush and evenly spaced:
 * View, the two toggles, the data facets, refresh — WHAT you are looking at
 * within that window and how you are narrowing it.
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
    groupBySeller,
    onGroupBySellerChange,
    filterOptions,
    filters,
    onFiltersChange,
    onRefresh,
    loading,
  } = props

  const isCustom = isCustomPeriod(periodMode)

  // A Month period is already one month: splitting it per month would produce
  // the identical single card. The toggle stays visible (so its existence is
  // still discoverable) but goes inert, rather than offering a no-op.
  const perMonthInert = periodMode === 'month'
  // Grouping by seller only means anything where the bars ARE transactions. The
  // other Views have already rolled up onto their own subject.
  const groupInert = view !== 'transactions'
  // What each toggle is actually doing to the report right now — which is what
  // it must render, not the intent ReportsPage is holding behind an inert
  // control. Must stay the same masking ReportsPage applies before building.
  const perMonthOn = groupByMonth && !perMonthInert
  const groupOn = groupBySeller && !groupInert

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

        {/* Everything from View rightward is one right-aligned run at a single
            gap — no separator, because the `ml-auto` whitespace is already the
            boundary and a rule inside the run would break the even spacing the
            group is built on. Left of it: what window you are looking at. Right
            of it: what you are looking at, and how you are narrowing it. */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FacetedFilter
            title="View"
            single
            options={VIEW_OPTIONS}
            selected={[view]}
            onChange={([v]) => onViewChange(v as ReportView)}
          />

          {/* Both toggles render pressed only while they are live: a disabled
              control still painted "on" claims an effect the report is not having.
              `disabled` carries the greying itself, from the button's own DS
              variant — nothing bespoke.

              On/off is signalled the way FacetedFilter already signals it two
              controls to the right — dashed border for "nothing set", solid
              `secondary` for "set" — so the whole header reads by one rule. The
              first cut laid a `bg-secondary` class over `outline` instead, which
              in dark mode was near-invisible: outline already paints
              `bg-input/30`, so pressing only took it to /50 — the same colour,
              20% more opaque.

              Icon-only, like Refresh: both are switches, not labelled choices,
              and the label is carried by `aria-label` + `title` rather than
              spending header width on two words apiece. */}
          <Button
            variant={perMonthOn ? 'secondary' : 'outline'}
            size="icon"
            className={cn('h-8 w-8', !perMonthOn && 'border-dashed')}
            onClick={() => onGroupByMonthChange(!groupByMonth)}
            disabled={perMonthInert}
            aria-pressed={perMonthOn}
            aria-label="One card per calendar month"
            title={
              perMonthInert
                ? 'Per month — the period is already a single month'
                : 'Per month — one card per calendar month'
            }
          >
            <CalendarRange className="h-4 w-4" />
          </Button>

          <Button
            variant={groupOn ? 'secondary' : 'outline'}
            size="icon"
            className={cn('h-8 w-8', !groupOn && 'border-dashed')}
            onClick={() => onGroupBySellerChange(!groupBySeller)}
            disabled={groupInert}
            aria-pressed={groupOn}
            aria-label="One bar per seller"
            title={
              groupInert
                ? 'Group — only applies to the Transactions view'
                : 'Group — one bar per seller, instead of one per transaction'
            }
          >
            <Group className="h-4 w-4" />
          </Button>

          {/* A fragment — its buttons are direct children of the run above, so
              they carry the same gap as everything else in it. */}
          {filterOptions && (
            <FilterBar options={filterOptions} filters={filters} onChange={onFiltersChange} />
          )}

          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
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
