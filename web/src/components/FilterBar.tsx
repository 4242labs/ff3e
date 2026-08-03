import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FacetedFilter } from '@/components/FacetedFilter'
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
  /** Data-table-only: which asset account(s) to collapse into a subtotal row
   * per period instead of one row per item. A multi-select whose OPTIONS are
   * every asset account in the dataset (same universe as Account) —
   * independent of what's currently selected in Account.
   *
   * Omitted on surfaces that have no item table to group (Reports), where the
   * facet would be a control that does nothing. */
  groupAccounts?: string[]
  onGroupAccountsChange?: (accounts: string[]) => void
}

/** The four data facets (+ Group, a fifth facet over the same account
 * universe as Account, independently selected). Lives in the header (not the
 * page body) so it costs no vertical space. */
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
      {/* Rendered only when there is something to clear. This used to be a
          fixed slot, always mounted and merely `invisible`, so the bar never
          shifted when a filter went on or off — but an empty 32px button plus
          its two gaps left a 48px hole in a run whose every other gap is 8px,
          and that asymmetry is visible on every load while the shift it avoids
          happens only at the moment you set the first filter. */}
      {active && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => onChange(EMPTY_FILTERS)}
          aria-label="Clear filters"
          title="Clear filters"
        >
          <X className="h-4 w-4" />
        </Button>
      )}

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
      {groupAccounts && onGroupAccountsChange && (
        <FacetedFilter
          title="Group"
          options={options.accounts.map((a) => ({ value: a, label: a }))}
          selected={groupAccounts}
          onChange={onGroupAccountsChange}
        />
      )}
      <FacetedFilter
        title="Currency"
        options={options.currencies.map((c) => ({ value: c, label: c }))}
        selected={filters.currency}
        onChange={(v) => set('currency', v)}
      />
    </>
  )
}
