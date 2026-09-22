import { Card, CardContent } from '@4242labs/design-system/components/card'
import { formatMoney } from '@/lib/format'
import type { ProjectionsResponse } from '@/lib/types'

export function SummaryCards({ currencies }: { currencies: ProjectionsResponse['currencies'] }) {
  const entries = Object.entries(currencies).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return null

  return (
    <section className="flex flex-col gap-4" aria-labelledby="summary-heading">
      <div className="sec-head">
        <h2 id="summary-heading">Cash position</h2>
      </div>
      <div className="flex flex-col gap-5">
        {entries.map(([currency, totals]) => (
          <div key={currency} className="flex flex-col gap-3">
            <p className="lbl">{currency}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <SummaryCard label="Out" value={totals.out} currency={currency} />
              <SummaryCard label="In" value={totals.in} currency={currency} />
              <SummaryCard label="Net" value={totals.net} currency={currency} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function SummaryCard({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <Card className="py-4">
      <CardContent className="flex items-baseline justify-between gap-3">
        <span className="lbl">{label}</span>
        <span className="num text-lg text-fg">{formatMoney(value, currency)}</span>
      </CardContent>
    </Card>
  )
}
