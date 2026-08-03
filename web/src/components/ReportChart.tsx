import { Fragment, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoney } from '@/lib/format'
import { FLOW_LABEL, pageCount, pageOf, type Flow, type ReportCard } from '@/lib/reports'

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
export function ReportChart({ data }: ReportChartProps) {
  const { title, currency, rows, max } = data
  const pages = pageCount(rows.length)
  const [page, setPage] = useState(0)

  // A filter or period change can shrink the list under the current page.
  // Clamping beats rendering an empty page the user has to navigate out of.
  useEffect(() => {
    setPage((p) => Math.min(p, pages - 1))
  }, [pages])

  const visible = pageOf(rows, page)

  // Net of what this card is showing: income MINUS expenses. Adding the two
  // together produces a number that means nothing — the first cut of this footer
  // did exactly that and reported 9,600 of income plus 705 of spend as "10,305".
  // Transfers are excluded outright: money moved between the user's own accounts
  // is neither earned nor spent.
  const shown = visible.reduce(
    (sum, row) => (row.flow === 'in' ? sum + row.total : row.flow === 'out' ? sum - row.total : sum),
    0,
  )

  return (
    <Card className="gap-2 py-4">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 space-y-0">
        <CardTitle className="text-sm">{title}</CardTitle>

        {/* Pagination rides in the header's right corner. The design system
            publishes no pagination primitive (see REGISTRY.md), so this is
            composed from the adopted `button` rather than hand-rolled — a
            bespoke primitive would fail DS gate 3, and adding one to the
            registry is a design-system change, not this app's to make. */}
        {pages > 1 && (
          <nav className="flex items-center gap-1" aria-label={`${title} pages`}>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="w-16 text-center text-xs tabular-nums text-muted-foreground">
              {page + 1} / {pages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1}
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </nav>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {/* One grid for the whole list, so the four columns align across rows.
            The label column is `max-content` — sized to the longest label rather
            than a fixed fraction, which is what kept short category names pinned
            to the right of an empty third. It is capped so a long transaction
            description cannot starve the bar. */}
        <div
          className="grid items-center gap-x-2 gap-y-1.5"
          style={{
            gridTemplateColumns: 'minmax(0, max-content) 1fr max-content max-content',
          }}
        >
          {visible.map((row) => (
            <Fragment key={row.key}>
              <div className="max-w-56 truncate text-right text-xs text-muted-foreground" title={row.label}>
                {row.label}
              </div>

              {/* The bar is this row's share of the largest row in the whole
                  list — not of the visible page — so lengths stay comparable as
                  you page through. */}
              <div className="h-5 min-w-0 overflow-hidden rounded-sm bg-muted">
                <div
                  className="h-full rounded-sm"
                  title={FLOW_LABEL[row.flow]}
                  style={{
                    width: max > 0 ? `${(row.total / max) * 100}%` : '0%',
                    backgroundColor: FLOW_COLOR[row.flow],
                  }}
                />
              </div>

              <div className="whitespace-nowrap text-right font-mono text-xs tabular-nums">
                {formatMoney(row.total, currency)}
              </div>
              <div className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                {row.detail}
              </div>
            </Fragment>
          ))}
        </div>

        {/* The total of what this card is showing. Card-title styling, so it
            reads as the figure the card resolves to rather than a footnote. */}
        <div className="flex justify-end border-t border-border pt-2">
          <span className="text-sm leading-none font-semibold tabular-nums">
            {formatMoney(shown, currency)}
          </span>
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
