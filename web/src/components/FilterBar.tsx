import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FacetedFilter } from '@/components/FacetedFilter'
import { cn } from '@/lib/utils'
import { EMPTY_FILTERS, hasActiveFilters, type FilterOptions } from '@/lib/filters'
import type { ActiveFilters, ItemType } from '@/lib/types'

const TYPE_LABEL: Record<ItemType, string> = {
  withdrawal: 'Expense',
  deposit: 'Income',
  transfer: 'Transfer',
}

export interface FilterBarProps {
  options: FilterOptions
  filters: ActiveFilters
  onChange: (filters: ActiveFilters) => void
  /** Data-table-only: which of the selected Account(s) to collapse into a
   * subtotal row per period instead of one row per item. A multi-select
   * whose OPTIONS are exactly the current Account selection — it can never
   * offer an account that isn't also in `filters.account`. */
  groupAccounts: string[]
  onGroupAccountsChange: (accounts: string[]) => void
}

/** The four data facets (+ Group, a fifth facet scoped to whatever Account
 * has selected). Lives in the header (not the page body) so it costs no
 * vertical space. */
export function FilterBar({
  options,
  filters,
  onChange,
  groupAccounts,
  onGroupAccountsChange,
}: FilterBarProps) {
  const set = <K extends keyof ActiveFilters>(key: K, value: ActiveFilters[K]) =>
    onChange({ ...filters, [key]: value })
  const active = hasActiveFilters(filters)

  return (
    <>
      {/* Fixed slot, always mounted — only its visibility toggles — so the
          rest of the bar never shifts when a filter is cleared/set. */}
      <Button
        variant="ghost"
        size="icon"
        className={cn('h-8 w-8', !active && 'invisible')}
        onClick={() => onChange(EMPTY_FILTERS)}
        disabled={!active}
        aria-label="Clear filters"
        title="Clear filters"
      >
        <X className="h-4 w-4" />
      </Button>

      <FacetedFilter
        title="Type"
        options={options.types.map((t) => ({ value: t, label: TYPE_LABEL[t] ?? t }))}
        selected={filters.type}
        onChange={(v) => set('type', v as ItemType[])}
      />
      <FacetedFilter
        title="Category"
        options={options.categories}
        selected={filters.category}
        onChange={(v) => set('category', v)}
      />
      <FacetedFilter
        title="Account"
        options={options.accounts.map((a) => ({ value: a, label: a }))}
        selected={filters.account}
        onChange={(v) => set('account', v)}
      />
      <FacetedFilter
        title="Group"
        options={filters.account.map((a) => ({ value: a, label: a }))}
        selected={groupAccounts}
        onChange={onGroupAccountsChange}
      />
      <FacetedFilter
        title="Currency"
        options={options.currencies.map((c) => ({ value: c, label: c }))}
        selected={filters.currency}
        onChange={(v) => set('currency', v)}
      />
    </>
  )
}
