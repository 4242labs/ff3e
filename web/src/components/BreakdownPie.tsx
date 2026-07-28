import { useMemo } from 'react'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { ChartCard } from '@/components/ChartCard'
import { colorForIndex } from '@/lib/colors'
import { chartTitle, formatMoney } from '@/lib/format'
import type { Period, PieGroupBy, ProjectionItem } from '@/lib/types'
import { EmptyState } from '@/components/EmptyState'

function groupKey(item: ProjectionItem, groupBy: PieGroupBy): string {
  switch (groupBy) {
    case 'category':
      return item.category ?? 'Uncategorised'
    case 'account':
      // The pie only ever sums withdrawals, so `source` is always the paying
      // asset account — the meaningful breakdown when categories are unset.
      return item.source ?? 'Uncategorised'
    case 'payee':
      return item.title || 'Uncategorised'
  }
}

const TITLE: Record<PieGroupBy, string> = {
  category: 'Category',
  account: 'Asset Account',
  payee: 'Top 5 Payees',
}

/** Max pie slices shown before the tail collapses into one "Other" slice
 * (also caps the legend, which mirrors the Pie's own data). Payee is far
 * higher cardinality than category/account (real data: ~40 unique titles),
 * so it gets a tighter top-5 cap rather than sharing the other two's top-8. */
const MAX_SLICES: Record<PieGroupBy, number> = {
  category: 8,
  account: 8,
  payee: 5,
}
// The legend lists every slice (up to MAX_SLICES + "Other") — never clipped
// or scrolled, so the chart's height is driven by how many rows the legend
// actually needs, not a fixed budget. ~18px/row plus room for the pie itself.
const LEGEND_ROW = 18
const MIN_CHART_HEIGHT = 150

interface Slice {
  name: string
  value: number
}

function BreakdownPieChart({
  data,
  currency,
  height,
}: {
  data: Slice[]
  currency: string
  height: number
}) {
  // Scales with the container: small in the compact card, large in the
  // fullscreen overlay. Only a thin margin held back so the pie fills the
  // card rather than floating in empty space, but never swallows the
  // legend column.
  const outerRadius = Math.max(45, Math.min(height / 2 - 10, 240))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        {/* Legend rides on the left (own column, full height, no clipping);
            the pie is re-centred right (cx) to leave it room instead of
            overlapping. paddingAngle only between real slices — on a single
            100% slice it carves a wedge-shaped notch ("pac-man"). */}
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="66%"
          cy="50%"
          innerRadius={0}
          outerRadius={outerRadius}
          paddingAngle={data.length > 1 ? 0.5 : 0}
          isAnimationActive={false}
        >
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={colorForIndex(i)} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value: number) => formatMoney(value, currency)}
          contentStyle={{
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            color: 'var(--popover-foreground)',
          }}
        />
        <Legend
          layout="vertical"
          verticalAlign="middle"
          align="left"
          wrapperStyle={{ fontSize: 11, lineHeight: '18px', maxWidth: '34%', whiteSpace: 'nowrap' }}
          // One line per entry, always — a long payee name gets an ellipsis
          // (full name in the title tooltip) instead of wrapping to a second
          // line and throwing off the row-count height math above. The
          // wrapper's `whiteSpace: nowrap` (above) stops the icon and label
          // from breaking onto separate lines; the span's own max-width
          // (icon + its margin subtracted) is what actually clips the text.
          formatter={(value: string) => (
            <span
              title={value}
              style={{
                display: 'inline-block',
                maxWidth: 'calc(100% - 20px)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                verticalAlign: 'middle',
              }}
            >
              {value}
            </span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

export interface BreakdownPieProps {
  /** Which field to group withdrawals by — one fixed pie per group-by, no
   * in-card switcher. */
  groupBy: PieGroupBy
  periods: Period[]
  /** Which currency this instance renders — the header's Currency filter
   * decides how many instances exist (see App.tsx), not a picker in here. */
  currency: string
  /** Append " — {currency}" to the title; only when a sibling instance for
   * another currency is also on screen. */
  showCurrencyInTitle: boolean
}

export function BreakdownPie({ groupBy, periods, currency, showCurrencyInTitle }: BreakdownPieProps) {
  const data = useMemo(() => {
    const totals = new Map<string, number>()
    for (const p of periods) {
      for (const it of p.items) {
        if (it.type !== 'withdrawal' || it.currency !== currency) continue
        const key = groupKey(it, groupBy)
        totals.set(key, (totals.get(key) ?? 0) + it.amount)
      }
    }
    const sorted = [...totals.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
    // High-cardinality group-bys blow out the Recharts legend past the card
    // bounds. Cap to the top N slices + a single "Other" bucket summing the
    // tail.
    const max = MAX_SLICES[groupBy]
    if (sorted.length <= max) return sorted
    const top = sorted.slice(0, max)
    const otherValue = sorted.slice(max).reduce((sum, s) => sum + s.value, 0)
    return [...top, { name: 'Other', value: otherValue }]
  }, [periods, groupBy, currency])

  const compactHeight = Math.max(MIN_CHART_HEIGHT, data.length * LEGEND_ROW + 24)

  return (
    <ChartCard title={chartTitle(TITLE[groupBy], currency, showCurrencyInTitle)} compactHeight={compactHeight}>
      {(height) =>
        data.length === 0 ? (
          <EmptyState message="No expenses in this range." />
        ) : (
          <BreakdownPieChart data={data} currency={currency} height={Number(height)} />
        )
      }
    </ChartCard>
  )
}
