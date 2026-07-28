import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { ChartCard } from '@/components/ChartCard'
import { EmptyState } from '@/components/EmptyState'
import { chartTitle, formatMoney } from '@/lib/format'
import type { Period } from '@/lib/types'

const COMPACT_HEIGHT = 200

// Axis ticks are unlabelled-currency and space-constrained — a compact
// "1.2k" reads far better here than the full ISO-code money string.
const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

interface Row {
  name: string
  In: number
  Out: number
  Net: number
}

function CashFlowTrendChart({
  data,
  currency,
  height,
}: {
  data: Row[]
  currency: string
  height: number | string
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
          axisLine={false}
          tickLine={false}
          width={40}
          tickFormatter={(v: number) => compactNumber.format(v)}
        />
        <Tooltip
          formatter={(value: number) => formatMoney(value, currency)}
          contentStyle={{
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            color: 'var(--popover-foreground)',
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="In" fill="var(--emerald)" radius={2} isAnimationActive={false} />
        <Bar dataKey="Out" fill="var(--red)" radius={2} isAnimationActive={false} />
        <Bar dataKey="Net" fill="var(--blue)" radius={2} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export interface CashFlowTrendProps {
  periods: Period[]
  /** Which currency this instance renders — the header's Currency filter
   * decides how many instances exist (see App.tsx), not a picker in here. */
  currency: string
  /** Append " — {currency}" to the title; only when a sibling instance for
   * another currency is also on screen. */
  showCurrencyInTitle: boolean
}

/**
 * In / Out / Net as a genuine time series, one group of bars per loaded
 * period, instead of PeriodBar's single aggregated snapshot. Only shows a
 * real trend when more than one period is loaded (the cumulative Overdue /
 * Due-this-month views); a single-period view renders one group.
 */
export function CashFlowTrend({ periods, currency, showCurrencyInTitle }: CashFlowTrendProps) {
  const data = useMemo<Row[]>(() => {
    return periods.map((p) => {
      const t = p.totals[currency] ?? {}
      const inflow = t.in ?? 0
      const out = t.out ?? 0
      return { name: p.label, In: inflow, Out: -out, Net: inflow - out }
    })
  }, [periods, currency])

  const hasValues = data.some((r) => r.In !== 0 || r.Out !== 0)

  return (
    <ChartCard title={chartTitle('Cash Flow', currency, showCurrencyInTitle)} compactHeight={COMPACT_HEIGHT}>
      {(height) =>
        !hasValues ? (
          <EmptyState message="No data in this range." />
        ) : (
          <CashFlowTrendChart data={data} currency={currency} height={height} />
        )
      }
    </ChartCard>
  )
}
