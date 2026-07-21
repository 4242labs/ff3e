import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/StatusBadge'
import { FlagBadges } from '@/components/FlagBadges'
import { EmptyState } from '@/components/EmptyState'
import { formatDate, formatMoney } from '@/lib/format'
import type { Period, ProjectionItem } from '@/lib/types'

const TYPE_LABEL: Record<ProjectionItem['type'], string> = {
  withdrawal: 'Expense',
  deposit: 'Income',
  transfer: 'Transfer',
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

/** One section per period (`label`), rows sorted by date (the
 * `periods` prop is already client-sorted by `key` before it gets here). */
export function PeriodTable({ periods }: { periods: Period[] }) {
  if (periods.length === 0) {
    return <EmptyState message="No obligations match the current filters." />
  }

  return (
    <div className="space-y-6">
      {periods.map((period) => (
        <Card key={period.key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{period.label}</CardTitle>
          </CardHeader>
          <CardContent>
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
                {period.items.map((item, i) => {
                  const installment = installmentLabel(item)
                  return (
                    <TableRow key={`${item.date}-${item.title}-${i}`}>
                      <TableCell className="whitespace-nowrap tabular-nums">{formatDate(item.date)}</TableCell>
                      <TableCell className="max-w-[240px]">
                        <span className="flex items-center gap-2">
                          <span className="truncate" title={item.title}>
                            {item.title}
                          </span>
                          {installment && (
                            <span
                              className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground"
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
                      <TableCell className="text-muted-foreground">{item.category ?? 'Uncategorised'}</TableCell>
                      <TableCell className="max-w-[240px] truncate" title={accountsLabel(item)}>
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
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
