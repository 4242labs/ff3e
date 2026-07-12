import { useEffect, useMemo, useState } from 'react'
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

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/EmptyState'
import { formatMoney } from '@/lib/format'
import type { Period } from '@/lib/types'

export interface PeriodBarProps {
  periods: Period[] // normally exactly one (day/month/year show one at a time)
  availableCurrencies: string[]
}

/** Currency with the largest total activity (|out| + |in|) — independent of
 * the pie's expense-only default so an income-only or transfer-only period
 * still picks a sensible currency instead of falling to "No data". */
export function currencyWithLargestActivity(periods: Period[]): string | null {
  const totals = new Map<string, number>()
  for (const p of periods) {
    for (const [cur, t] of Object.entries(p.totals)) {
      const activity = Math.abs(t.out ?? 0) + Math.abs(t.in ?? 0)
      totals.set(cur, (totals.get(cur) ?? 0) + activity)
    }
  }
  let best: string | null = null
  let bestVal = -Infinity
  for (const [cur, val] of totals) {
    if (val > bestVal) {
      best = cur
      bestVal = val
    }
  }
  return best
}

interface Row {
  name: 'In' | 'Out' | 'Net'
  value: number // signed for the diverging axis: In +, Out −, Net = In−Out
  magnitude: number // the real (labelled) amount
  fill: string
}

/**
 * Single-period In / Out / Net as a diverging horizontal bar around a zero
 * axis: income extends right (emerald), expense left
 * (red), net is the signed remainder (blue). With one period on screen a
 * time-series bar had nothing to trend, so this reads the three totals
 * directly instead.
 */
export function PeriodBar({ periods, availableCurrencies }: PeriodBarProps) {
  const defaultCurrency = useMemo(() => currencyWithLargestActivity(periods), [periods])
  const [currency, setCurrency] = useState<string | null>(defaultCurrency)

  useEffect(() => {
    if (!currency || !availableCurrencies.includes(currency)) {
      setCurrency(defaultCurrency)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCurrency, availableCurrencies])

  const data = useMemo<Row[]>(() => {
    if (!currency) return []
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
  // Symmetric domain so zero sits in the CENTRE (a proper diverging axis):
  // income right, expense left. Without this Recharts auto-domains to
  // [min,max] and, when there's no income, pins 0 to the right edge.
  const maxAbs = Math.max(1, ...data.map((r) => Math.abs(r.value)))

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">In / Out / Net</CardTitle>
        {availableCurrencies.length > 1 && (
          <Select value={currency ?? undefined} onValueChange={setCurrency}>
            <SelectTrigger className="h-8 w-24" aria-label="Bar chart currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableCurrencies.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent>
        {!currency || !hasValues ? (
          <EmptyState message="No data in this period." />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
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
              <Bar dataKey="value" radius={3} barSize={34} isAnimationActive={false}>
                {data.map((row) => (
                  <Cell key={row.name} fill={row.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
