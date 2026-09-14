import { CalendarRange, ChevronLeft, ChevronRight, Group, RefreshCw } from 'lucide-react'

import { DateRangePicker } from '@/components/DateRangePicker'
import { FacetedFilter } from '@/components/FacetedFilter'
import { FilterBar } from '@/components/FilterBar'
import { PeriodPicker } from '@/components/PeriodPicker'
import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { TopBar, TopBarActions, TopBarRailLead } from '@/components/ui/top-bar'
import type { FilterOptions } from '@/lib/filters'
import {
  isCustomPeriod,
  type ActiveFilters,
  type Granularity,
  type ReportPeriodMode,
  type ReportView,
} from '@/lib/types'

const PERIOD_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'custom', label: 'Custom range', short: 'Custom' },
]

const VIEW_OPTIONS = [
  { value: 'transactions', label: 'Transactions' },
  { value: 'categories', label: 'Categories' },
  { value: 'accounts', label: 'Accounts' },
]

export interface ReportsNavProps {
  periodMode: ReportPeriodMode
  onPeriodModeChange: (mode: ReportPeriodMode) => void
  anchor: string
  label: string
  isCurrent: boolean
  custom: { start: string; end: string }
  onCustomChange: (range: { start: string; end: string }) => void
  onPrev: () => void
  onNext: () => void
  onPick: (iso: string) => void
  onToday: () => void
  view: ReportView
  onViewChange: (view: ReportView) => void
  groupByMonth: boolean
  onGroupByMonthChange: (on: boolean) => void
  groupBySeller: boolean
  onGroupBySellerChange: (on: boolean) => void
  filterOptions: FilterOptions | null
  filters: ActiveFilters
  onFiltersChange: (filters: ActiveFilters) => void
  onRefresh: () => void
  loading: boolean
  demo?: boolean
}

export function ReportsNav(props: ReportsNavProps) {
  const isCustom = isCustomPeriod(props.periodMode)
  const perMonthInert = props.periodMode === 'month'
  const groupInert = props.view !== 'transactions'
  const perMonthOn = props.groupByMonth && !perMonthInert
  const groupOn = props.groupBySeller && !groupInert

  return (
    <TopBar variant="compact" lane="2xl">
      <TopBarRailLead>
        <SidebarTrigger />
      </TopBarRailLead>

      <FacetedFilter
        title="Period"
        single
        options={PERIOD_OPTIONS}
        selected={[props.periodMode]}
        onChange={([value]) => props.onPeriodModeChange(value as ReportPeriodMode)}
        disabled={props.demo}
      />

      {props.demo ? (
        <span className="barbtn" aria-label={`Demo period ${props.label}`}>
          <span className="value num">{props.label}</span>
        </span>
      ) : isCustom ? (
        <DateRangePicker start={props.custom.start} end={props.custom.end} onChange={props.onCustomChange} />
      ) : (
        <div className="flex items-center gap-1">
          <Button className="btn btn-icon" variant="ghost" size="icon-sm" onClick={props.onPrev} aria-label="Previous period">
            <ChevronLeft />
          </Button>
          <PeriodPicker
            granularity={props.periodMode as Granularity}
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
        <FacetedFilter
          title="View"
          single
          options={VIEW_OPTIONS}
          selected={[props.view]}
          onChange={([value]) => props.onViewChange(value as ReportView)}
        />

        <Button
          className="barbtn"
          variant="ghost"
          onClick={() => props.onGroupByMonthChange(!props.groupByMonth)}
          disabled={perMonthInert}
          aria-pressed={perMonthOn}
          aria-label="One card per calendar month"
          title={perMonthInert ? 'The period is already one month' : 'One card per calendar month'}
        >
          <CalendarRange />
          Month
        </Button>

        <Button
          className="barbtn"
          variant="ghost"
          onClick={() => props.onGroupBySellerChange(!props.groupBySeller)}
          disabled={groupInert}
          aria-pressed={groupOn}
          aria-label="One bar per seller"
          title={groupInert ? 'Only applies to Transactions' : 'One bar per seller'}
        >
          <Group />
          Group
        </Button>

        {props.filterOptions ? <FilterBar options={props.filterOptions} filters={props.filters} onChange={props.onFiltersChange} /> : null}

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
