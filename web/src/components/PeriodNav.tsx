import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  RefreshCw,
  Table2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { FacetedFilter } from '@/components/FacetedFilter'
import { FilterBar } from '@/components/FilterBar'
import { PeriodPicker } from '@/components/PeriodPicker'
import { STATUS_COLOR } from '@/lib/colors'
import type { FilterOptions } from '@/lib/filters'
import { cn } from '@/lib/utils'
import {
  isCumulativeMode,
  type ActiveFilters,
  type DashboardMode,
  type Granularity,
  type ViewMode,
} from '@/lib/types'

const DASHBOARD_MODE_OPTIONS: { value: DashboardMode; label: string; icon: typeof LayoutDashboard }[] =
  [
    { value: 'dashboard', label: 'Dashboard (cards + charts)', icon: LayoutDashboard },
    { value: 'data', label: 'Data (table)', icon: Table2 },
  ]

const VIEW_OPTIONS: { value: ViewMode; label: string; short?: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'outstanding', label: 'Overdue' },
  { value: 'month_end', label: 'Due this month', short: 'This month' },
]

export interface PeriodNavProps {
  mode: ViewMode
  onModeChange: (m: ViewMode) => void
  anchor: string
  /** Calendar modes: the period label ("Jul 2026"). Cumulative modes: the
   * cutoff caption ("through Jul 31, 2026"). */
  label: string
  isCurrent: boolean
  onPrev: () => void
  onNext: () => void
  onPick: (iso: string) => void
  onToday: () => void
  onRefresh: () => void
  loading: boolean
  needsReviewCount: number
  filterOptions: FilterOptions | null
  filters: ActiveFilters
  onFiltersChange: (f: ActiveFilters) => void
  /** Dashboard (cards + charts) vs data (table) — mutually exclusive. */
  dashboardMode: DashboardMode
  onDashboardModeChange: (m: DashboardMode) => void
  groupAccounts: string[]
  onGroupAccountsChange: (accounts: string[]) => void
}

/**
 * Single header bar carrying every control: the View switch (a single-select
 * chip, same affordance as the data facets), the period navigator, and all
 * four data filters — so none of it costs vertical space in the page body.
 */
export function PeriodNav(props: PeriodNavProps) {
  const {
    mode,
    onModeChange,
    anchor,
    label,
    isCurrent,
    onPrev,
    onNext,
    onPick,
    onToday,
    onRefresh,
    loading,
    needsReviewCount,
    filterOptions,
    filters,
    onFiltersChange,
    dashboardMode,
    onDashboardModeChange,
    groupAccounts,
    onGroupAccountsChange,
  } = props

  const cumulative = isCumulativeMode(mode)

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex w-full max-w-7xl flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-1 hidden h-5 sm:block" />

        <FacetedFilter
          title="View"
          single
          options={VIEW_OPTIONS}
          selected={[mode]}
          onChange={([v]) => onModeChange(v as ViewMode)}
        />

        {cumulative ? (
          <span className="px-1 text-sm font-medium tabular-nums text-muted-foreground">
            {label}
          </span>
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
              granularity={mode as Granularity}
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

        {/* Filters (+ status/refresh) ride on the RIGHT: the left of the bar is
            "what am I looking at" (view + period), the right is "how am I
            narrowing it". */}
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {filterOptions && (
            <FilterBar
              options={filterOptions}
              filters={filters}
              onChange={onFiltersChange}
              groupAccounts={groupAccounts}
              onGroupAccountsChange={onGroupAccountsChange}
            />
          )}

          {needsReviewCount > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold"
              style={{
                color: STATUS_COLOR.needs_review,
                borderColor: STATUS_COLOR.needs_review,
                backgroundColor: 'color-mix(in srgb, var(--amber) 15%, transparent)',
              }}
              title="Past due with no matching transaction found"
            >
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
              {needsReviewCount}
            </span>
          )}
          <div
            className="inline-flex overflow-hidden rounded-md border border-input"
            role="group"
            aria-label="Display"
          >
            {DASHBOARD_MODE_OPTIONS.map(({ value, label, icon: Icon }, i) => (
              <Button
                key={value}
                variant="ghost"
                size="icon"
                className={cn(
                  'h-8 w-8 rounded-none',
                  i > 0 && 'border-l border-input',
                  dashboardMode === value && 'bg-secondary text-secondary-foreground',
                )}
                onClick={() => onDashboardModeChange(value)}
                aria-pressed={dashboardMode === value}
                aria-label={label}
                title={label}
              >
                <Icon className="h-4 w-4" />
              </Button>
            ))}
          </div>
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
