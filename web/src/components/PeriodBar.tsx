import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartCard } from '@/components/ChartCard'
import { EmptyState } from '@/components/EmptyState'
import { chartTitle, formatMoney } from '@/lib/format'
import type { Period } from '@/lib/types'

export interface PeriodBarProps {
  periods: Period[] // normally exactly one (day/month/year show one at a time)
  /** Which currency this instance renders — the header's Currency filter
   * decides how many instances exist (see App.tsx), not a picker in here. */
  currency: string
  /** Append " — {currency}" to the title; only when a sibling instance for
   * another currency is also on screen. */
  showCurrencyInTitle: boolean
}

// Matches BreakdownPie's minimum card height — this and the pies sit side by
// side in the same grid row.
const COMPACT_HEIGHT = 170

interface Row {
  name: 'In' | 'Out' | 'Net'
  value: number // signed for the diverging axis: In +, Out −, Net = In−Out
  magnitude: number // the real (labelled) amount
  fill: string
}

function PeriodBarChart({
  data,
  currency,
  height,
}: {
  data: Row[]
  currency: string
  height: number | string
}) {
  // Symmetric domain so zero sits in the CENTRE (a proper diverging axis):
  // income right, expense left. Without this Recharts auto-domains to
  // [min,max] and, when there's no income, pins 0 to the right edge.
  const maxAbs = Math.max(1, ...data.map((r) => Math.abs(r.value)))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart layout="vertical" data={data} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
        {/* Hide numeric ticks: on a symmetric diverging axis the abs
            formatter prints the same value on both ends (confusing), and
            the exact In/Out/Net figures already live in the summary
            cards + tooltip. Keep the axis purely as the centred zero. */}
        <XAxis type="number" domain={[-maxAbs, maxAbs]} hide />
        <ReferenceLine x={0} stroke="var(--fg-muted)" />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 12, fill: 'var(--fg-muted)' }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
          width={44}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
          formatter={(_value: number, _name: string, item: { payload?: Row }) =>
            formatMoney(item?.payload?.magnitude ?? 0, currency)
          }
          labelFormatter={() => ''}
          contentStyle={{
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            color: 'var(--popover-foreground)',
          }}
        />
        <Bar dataKey="value" radius={3} barSize={24} isAnimationActive={false}>
          {data.map((row) => (
            <Cell key={row.name} fill={row.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

/**
 * Single-period In / Out / Net as a diverging horizontal bar around a zero
 * axis: income extends right (emerald), expense left
 * (red), net is the signed remainder (blue). With one period on screen a
 * time-series bar had nothing to trend, so this reads the three totals
 * directly instead.
 */
export function PeriodBar({ periods, currency, showCurrencyInTitle }: PeriodBarProps) {
  const data = useMemo<Row[]>(() => {
    // Sum across the given periods (normally exactly one).
    let out = 0
    let inflow = 0
    for (const p of periods) {
      const t = p.totals[currency] ?? {}
      out += t.out ?? 0
      inflow += t.in ?? 0
    }
    const net = inflow - out
    return [
      { name: 'In', value: inflow, magnitude: inflow, fill: 'var(--emerald)' },
      { name: 'Out', value: -out, magnitude: out, fill: 'var(--red)' },
      { name: 'Net', value: net, magnitude: net, fill: 'var(--blue)' },
    ]
  }, [periods, currency])

  const hasValues = data.some((r) => r.magnitude !== 0)

  return (
    <ChartCard
      title={chartTitle('In / Out / Net', currency, showCurrencyInTitle)}
      compactHeight={COMPACT_HEIGHT}
    >
      {(height) =>
        !hasValues ? (
          <EmptyState message="No data in this period." />
        ) : (
          <PeriodBarChart data={data} currency={currency} height={height} />
        )
      }
    </ChartCard>
  )
}
