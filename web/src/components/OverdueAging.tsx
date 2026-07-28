import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { ChartCard } from '@/components/ChartCard'
import { EmptyState } from '@/components/EmptyState'
import { STATUS_COLOR } from '@/lib/colors'
import { anchorToDate, todayISO } from '@/lib/range'
import type { Period } from '@/lib/types'

const COMPACT_HEIGHT = 170

const BUCKETS: { label: string; max: number }[] = [
  { label: '0–7d', max: 7 },
  { label: '8–14d', max: 14 },
  { label: '15–30d', max: 30 },
  { label: '31–60d', max: 60 },
  { label: '60d+', max: Infinity },
]

function bucketFor(days: number): string {
  for (const b of BUCKETS) {
    if (days <= b.max) return b.label
  }
  return BUCKETS[BUCKETS.length - 1].label
}

interface Row {
  name: string
  count: number
}

function OverdueAgingChart({ data, height }: { data: Row[]; height: number | string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
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

export interface OverdueAgingProps {
  periods: Period[]
}

/**
 * How long the current needs-review items have been sitting unmatched — days
 * since the expected date, bucketed. Only `needs_review` counts here;
 * `upcoming` and `acknowledged_gap` aren't "aging" in the same sense.
 */
export function OverdueAging({ periods }: OverdueAgingProps) {
  const data: Row[] = useMemo(() => {
    const today = anchorToDate(todayISO())
    const counts = new Map<string, number>()
    for (const b of BUCKETS) counts.set(b.label, 0)
    for (const p of periods) {
      for (const it of p.items) {
        if (it.status !== 'needs_review') continue
        const days = Math.floor((today.getTime() - anchorToDate(it.date).getTime()) / 86_400_000)
        const label = bucketFor(Math.max(0, days))
        counts.set(label, (counts.get(label) ?? 0) + 1)
      }
    }
    return BUCKETS.map((b) => ({ name: b.label, count: counts.get(b.label) ?? 0 }))
  }, [periods])

  const total = data.reduce((sum, r) => sum + r.count, 0)

  return (
    <ChartCard title="Needs review — days overdue" compactHeight={COMPACT_HEIGHT}>
      {(height) =>
        total === 0 ? (
          <EmptyState message="Nothing needs review right now." />
        ) : (
          <OverdueAgingChart data={data} height={height} />
        )
      }
    </ChartCard>
  )
}
