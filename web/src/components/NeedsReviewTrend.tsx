import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { ChartCard } from '@/components/ChartCard'
import { EmptyState } from '@/components/EmptyState'
import { STATUS_COLOR } from '@/lib/colors'
import type { Period } from '@/lib/types'

const COMPACT_HEIGHT = 170

interface Row {
  name: string
  count: number
}

function NeedsReviewTrendChart({ data, height }: { data: Row[]; height: number | string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
          axisLine={false}
          tickLine={false}
          width={28}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
          formatter={(value: number) => [`${value}`, 'Needs review']}
          contentStyle={{
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            color: 'var(--popover-foreground)',
          }}
        />
        <Bar dataKey="count" fill={STATUS_COLOR.needs_review} radius={3} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export interface NeedsReviewTrendProps {
  periods: Period[]
}

/**
 * How many occurrences are stuck in "needs review" per loaded period — the
 * product's actual differentiator (never guess a match). Most legible in the
 * cumulative Overdue view, where `periods` spans several months; in a
 * single-period view it's just one bar.
 */
export function NeedsReviewTrend({ periods }: NeedsReviewTrendProps) {
  const data: Row[] = periods.map((p) => ({
    name: p.label,
    count: p.items.filter((it) => it.status === 'needs_review').length,
  }))
  const total = data.reduce((sum, r) => sum + r.count, 0)

  return (
    <ChartCard title="Needs review, per period" compactHeight={COMPACT_HEIGHT}>
      {(height) =>
        total === 0 ? (
          <EmptyState message="Nothing needs review in this range." />
        ) : (
          <NeedsReviewTrendChart data={data} height={height} />
        )
      }
    </ChartCard>
  )
}
