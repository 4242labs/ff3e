import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { ChartCard } from '@/components/ChartCard'
import { EmptyState } from '@/components/EmptyState'
import { STATUS_COLOR, STATUS_LABEL } from '@/lib/colors'
import type { ItemStatus, Period } from '@/lib/types'

const COMPACT_HEIGHT = 190

// Review-relevant first, routine outcomes last.
const STATUS_ORDER: ItemStatus[] = [
  'needs_review',
  'upcoming',
  'acknowledged_gap',
  'paid',
  'received',
  'done',
]

interface Row {
  status: ItemStatus
  name: string
  count: number
  fill: string
}

function StatusBreakdownChart({ data, height }: { data: Row[]; height: number | string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
          axisLine={{ stroke: 'var(--border)' }}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 11, fill: 'var(--fg-muted)' }}
          axisLine={false}
          tickLine={false}
          width={92}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
          formatter={(value: number) => [`${value}`, 'Items']}
          contentStyle={{
            background: 'var(--popover)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            color: 'var(--popover-foreground)',
          }}
        />
        <Bar dataKey="count" radius={3} barSize={16} isAnimationActive={false}>
          {data.map((row) => (
            <Cell key={row.status} fill={row.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export interface StatusBreakdownProps {
  periods: Period[]
}

/**
 * Item counts by status across every currently loaded period — a snapshot
 * of the review burden. Counts, not money, so summing across currencies here
 * isn't the cross-sum the product principles forbid (that's about totals).
 */
export function StatusBreakdown({ periods }: StatusBreakdownProps) {
  const data: Row[] = useMemo(() => {
    const counts = new Map<ItemStatus, number>()
    for (const p of periods) {
      for (const it of p.items) {
        counts.set(it.status, (counts.get(it.status) ?? 0) + 1)
      }
    }
    return STATUS_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => ({
      status: s,
      name: STATUS_LABEL[s],
      count: counts.get(s) ?? 0,
      fill: STATUS_COLOR[s],
    }))
  }, [periods])

  return (
    <ChartCard title="Items by status" compactHeight={COMPACT_HEIGHT}>
      {(height) =>
        data.length === 0 ? (
          <EmptyState message="No items in this range." />
        ) : (
          <StatusBreakdownChart data={data} height={height} />
        )
      }
    </ChartCard>
  )
}
