import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { FlagBadges } from '@/components/FlagBadges'
import { EmptyState } from '@/components/EmptyState'
import { formatDate, formatMoney } from '@/lib/format'
import { assetAccountsOf, groupItemsByAccount } from '@/lib/filters'
import type { Period, ProjectionItem } from '@/lib/types'

const TYPE_LABEL: Record<ProjectionItem['type'], string> = {
  withdrawal: 'Expense',
  deposit: 'Income',
  transfer: 'Transfer',
}

const FLOW_LABEL: Record<'out' | 'in', string> = {
  out: 'Out',
  in: 'In',
}

function accountsLabel(item: ProjectionItem): string {
  if (item.type === 'transfer') return `${item.source ?? '—'} → ${item.destination ?? '—'}`
  if (item.type === 'deposit') return item.destination ?? item.source ?? '—'
  return item.source ?? item.destination ?? '—'
}

/** Installment position "N/T" (e.g. 3/10) for a finite series, or null. Both
 * ends must be present — an open-ended commitment shows nothing. */
function installmentLabel(item: ProjectionItem): string | null {
  if (item.installment_no == null || item.installment_total == null) return null
  return `${item.installment_no}/${item.installment_total}`
}

/** An item is pulled out of the item-by-item list only once EVERY one of its
 * own-side accounts is in the grouped set — a transfer with only one side
 * grouped stays in both places, since the ungrouped side still needs an
 * auditable row of its own. */
function isFullyGrouped(item: ProjectionItem, groupAccounts: string[]): boolean {
  const accounts = assetAccountsOf(item)
  return accounts.length > 0 && accounts.every((a) => groupAccounts.includes(a))
}

export interface PeriodTableProps {
  periods: Period[]
  /** Which asset account(s) to collapse into a subtotal row per period
   * instead of one row per item — independent of the Account filter. Items
   * touching an account outside this list keep their normal item row
   * alongside any subtotal rows. */
  groupAccounts?: string[]
}

/** One section per period (`label`): a subtotal-per-account table for
 * whatever's in `groupAccounts`, then an item-by-item table for everything
 * else (rows sorted by date, the `periods` prop is already client-sorted by
 * `key` before it gets here). */
export function PeriodTable({ periods, groupAccounts = [] }: PeriodTableProps) {
  if (periods.length === 0) {
    return <EmptyState message="No obligations match the current filters." />
  }

  return (
    <div className="space-y-6">
      {periods.map((period) => {
        const subtotals =
          groupAccounts.length > 0 ? groupItemsByAccount(period.items, groupAccounts) : []
        const remainder =
          groupAccounts.length > 0
            ? period.items.filter((item) => !isFullyGrouped(item, groupAccounts))
            : period.items

        return (
          <Card key={period.key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{period.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {subtotals.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Flow</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subtotals.map((row) => (
                      <TableRow key={`${row.account}-${row.flow}-${row.currency}`}>
                        <TableCell className="max-w-60 truncate" title={row.account}>
                          {row.account}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{FLOW_LABEL[row.flow]}</TableCell>
                        <TableCell className="text-muted-foreground">{row.currency}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.count}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {formatMoney(row.amount, row.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {remainder.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Account(s)</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {remainder.map((item, i) => {
                      const installment = installmentLabel(item)
                      return (
                        <TableRow key={`${item.date}-${item.title}-${i}`}>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            {formatDate(item.date)}
                          </TableCell>
                          <TableCell className="max-w-60">
                            <span className="flex items-center gap-2">
                              <span className="truncate" title={item.title}>
                                {item.title}
                              </span>
                              {installment && (
                                <span
                                  className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs tabular-nums text-muted-foreground"
                                  title={`Installment ${installment}`}
                                >
                                  {installment}
                                </span>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {TYPE_LABEL[item.type]}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {item.category ?? 'Uncategorised'}
                          </TableCell>
                          <TableCell className="max-w-60 truncate" title={accountsLabel(item)}>
                            {accountsLabel(item)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            {formatMoney(item.amount, item.currency)}
                          </TableCell>
                          <TableCell>
                            <span className="flex flex-wrap items-center gap-1.5">
                              <StatusBadge status={item.status} />
                              <FlagBadges flags={item.flags} />
                            </span>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
