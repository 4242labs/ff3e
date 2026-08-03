import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoney } from '@/lib/format'
import {
  FLOW_LABEL,
  PAGE_SIZE,
  pageCount,
  pageOf,
  type Flow,
  type ReportCard,
} from '@/lib/reports'

/** Bar colour by direction. Expense is the report's main subject and takes the
 * accent; income and transfers are distinguished so a mixed list stays readable
 * without a per-row label. */
const FLOW_COLOR: Record<Flow, string> = {
  out: 'var(--orange-500)',
  in: 'var(--emerald)',
  xfer: 'var(--blue)',
}

export interface ReportChartProps {
  data: ReportCard
  /** Caption beside the title — the window and what a bar means. */
  caption: string
}

/**
 * One report, one currency: a ranked horizontal bar per subject, largest first,
 * 25 rows to a page.
 *
 * Deliberately plain markup rather than a charting library. These bars are a
 * ranking, not a plot — there is no axis worth drawing, the label and the value
 * belong on the row itself, and the list has to stay legible at 25 rows. Every
 * colour and dimension comes off the token layer, so it themes with the app.
 */
export function ReportChart({ data, caption }: ReportChartProps) {
  const { title, currency, rows, totals, max } = data
  const pages = pageCount(rows.length)
  const [page, setPage] = useState(0)

  // A filter or period change can shrink the list under the current page.
  // Clamping beats rendering an empty page the user has to navigate out of.
  useEffect(() => {
    setPage((p) => Math.min(p, pages - 1))
  }, [pages])

  const visible = pageOf(rows, page)
  const first = rows.length === 0 ? 0 : page * PAGE_SIZE + 1
  const last = Math.min(rows.length, (page + 1) * PAGE_SIZE)

  return (
    <Card className="gap-2 py-4">
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-x-4 gap-y-1 space-y-0">
        <CardTitle className="text-sm">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{caption}</p>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {/* Proportional widths, not fixed ones: cards divide a row, so the same
            row markup has to hold at full width and at a sixth of it. */}
        <div className="flex flex-col gap-1.5">
          {visible.map((row) => (
            <div key={row.key} className="flex items-center gap-2">
              <div
                className="min-w-0 basis-1/3 truncate text-right text-xs text-muted-foreground"
                title={row.label}
              >
                {row.label}
              </div>

              {/* The track is the remaining width; the bar is this row's share of
                  the largest row in the whole list — not of the visible page — so
                  bar lengths stay comparable as you page through. */}
              <div className="h-5 min-w-0 flex-1 overflow-hidden rounded-sm bg-muted">
                <div
                  className="h-full rounded-sm"
                  title={FLOW_LABEL[row.flow]}
                  style={{
                    width: max > 0 ? `${(row.total / max) * 100}%` : '0%',
                    backgroundColor: FLOW_COLOR[row.flow],
                  }}
                />
              </div>

              <div className="shrink-0 whitespace-nowrap text-right font-mono text-xs tabular-nums">
                {formatMoney(row.total, currency)}
              </div>
              <div
                className="min-w-0 basis-1/6 truncate text-xs tabular-nums text-muted-foreground"
                title={row.detail}
              >
                {row.detail}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {rows.length === 0
              ? 'No transactions'
              : `${first}–${last} of ${rows.length}`}
          </span>

          {/* Totals for the WHOLE window, never the visible page — a page total
              would read as a period total and quietly mislead. */}
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono tabular-nums">
            {totals.out > 0 && <span>out {formatMoney(totals.out, currency)}</span>}
            {totals.in > 0 && <span>in {formatMoney(totals.in, currency)}</span>}
            {totals.xfer > 0 && <span>transfers {formatMoney(totals.xfer, currency)}</span>}
          </span>

          {pages > 1 && (
            <span className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                aria-label={`Previous page of ${currency} rows`}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="w-16 text-center tabular-nums">
                {page + 1} / {pages}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                disabled={page >= pages - 1}
                aria-label={`Next page of ${currency} rows`}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/** Legend for the direction colours the bars carry. One per page, under the
 * cards — repeating it on every card would cost more room than it explains. */
export function ReportFlowLegend({ flows }: { flows: Flow[] }) {
  if (flows.length === 0) return null
  const order: Flow[] = ['out', 'in', 'xfer']
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {order
        .filter((f) => flows.includes(f))
        .map((flow) => (
          <span key={flow} className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: FLOW_COLOR[flow] }}
            />
            {FLOW_LABEL[flow]}
          </span>
        ))}
    </div>
  )
}
