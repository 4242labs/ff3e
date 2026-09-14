import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'

import { FacetedFilter } from '@/components/FacetedFilter'
import { FilterBar } from '@/components/FilterBar'
import { PeriodPicker } from '@/components/PeriodPicker'
import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { TopBar, TopBarActions, TopBarRailLead } from '@/components/ui/top-bar'
import type { FilterOptions } from '@/lib/filters'
import {
  isCumulativeMode,
  type ActiveFilters,
  type Granularity,
  type ViewMode,
} from '@/lib/types'

const VIEW_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'outstanding', label: 'Overdue' },
  { value: 'month_end', label: 'Due this month', short: 'This month' },
]

export interface PeriodNavProps {
  mode: ViewMode
  onModeChange: (mode: ViewMode) => void
  anchor: string
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
  onFiltersChange: (filters: ActiveFilters) => void
  groupAccounts?: string[]
  onGroupAccountsChange?: (accounts: string[]) => void
}

export function PeriodNav(props: PeriodNavProps) {
  const cumulative = isCumulativeMode(props.mode)

  return (
    <TopBar variant="compact" lane="2xl">
      <TopBarRailLead>
        <SidebarTrigger />
      </TopBarRailLead>

      <FacetedFilter
        title="View"
        single
        options={VIEW_OPTIONS}
        selected={[props.mode]}
        onChange={([value]) => props.onModeChange(value as ViewMode)}
      />

      {cumulative ? (
        <span className="barbtn" aria-label={props.label}>
          <span className="value num">{props.label}</span>
        </span>
      ) : (
        <div className="flex items-center gap-1">
          <Button className="btn btn-icon" variant="ghost" size="icon-sm" onClick={props.onPrev} aria-label="Previous period">
            <ChevronLeft />
          </Button>
          <PeriodPicker
            granularity={props.mode as Granularity}
            anchor={props.anchor}
            label={props.label}
            isCurrent={props.isCurrent}
            onPick={props.onPick}
            onToday={props.onToday}
          />
          <Button className="btn btn-icon" variant="ghost" size="icon-sm" onClick={props.onNext} aria-label="Next period">
            <ChevronRight />
          </Button>
        </div>
      )}

      <TopBarActions>
        {props.filterOptions ? (
          <FilterBar
            options={props.filterOptions}
            filters={props.filters}
            onChange={props.onFiltersChange}
            groupAccounts={props.groupAccounts}
            onGroupAccountsChange={props.onGroupAccountsChange}
          />
        ) : null}

        {props.needsReviewCount > 0 ? (
          <span className="marker" data-status="warning" title="Past due with no matching transaction found">
            <AlertTriangle className="sr-only" aria-hidden="true" />
            Review <span className="count">{props.needsReviewCount}</span>
          </span>
        ) : null}

        <Button
          className="btn btn-icon"
          variant="ghost"
          size="icon-sm"
          onClick={props.onRefresh}
          disabled={props.loading}
          data-loading={props.loading || undefined}
          aria-label="Refresh"
        >
          <RefreshCw />
        </Button>
      </TopBarActions>
    </TopBar>
  )
}
