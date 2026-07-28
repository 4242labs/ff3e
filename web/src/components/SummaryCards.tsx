import { Card, CardContent } from '@/components/ui/card'
import { formatMoney } from '@/lib/format'
import type { ProjectionsResponse } from '@/lib/types'

/** Per-currency Out/In/Net cards. Never cross-sums currencies
 * — one group per ISO code. No group heading: every card already stamps the
 * ISO code inside the amount ("BRL 8,390.14"), so a "BRL" label above it was
 * pure duplication. */
export function SummaryCards({ currencies }: { currencies: ProjectionsResponse['currencies'] }) {
  const entries = Object.entries(currencies).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return null

  return (
    <div className="space-y-5">
      {entries.map(([cur, totals]) => (
        <div key={cur}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard label="Out" value={totals.out} currency={cur} color="var(--red)" />
            <SummaryCard label="In" value={totals.in} currency={cur} color="var(--emerald)" />
            <SummaryCard
              label="Net"
              value={totals.net}
              currency={cur}
              color={totals.net >= 0 ? 'var(--emerald)' : 'var(--red)'}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  currency,
  color,
}: {
  label: string
  value: number
  currency: string
  color: string
}) {
  return (
    <Card className="py-4">
      <CardContent className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="text-lg font-semibold tabular-nums" style={{ color }}>
          {formatMoney(value, currency)}
        </span>
      </CardContent>
    </Card>
  )
}
