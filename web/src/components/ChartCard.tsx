import { useState, type ReactNode } from 'react'
import { Maximize2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export interface ChartCardProps {
  title: string
  /** Per-chart controls (e.g. a currency select) that sit next to the expand
   * button in both the card header and the overlay header. */
  headerExtra?: ReactNode
  /** The chart body, as a function of the height it should render at — called
   * once for the compact card, once (larger) for the fullscreen overlay, so
   * both share one chart definition instead of two copies drifting apart. */
  children: (height: number | string) => ReactNode
  compactHeight: number
}

/** Height of the chart's plot area inside the fullscreen overlay — the
 * dialog itself is sized by viewport (see DialogContent below); this is
 * fixed rather than measured because Recharts needs a concrete number. */
const OVERLAY_CHART_HEIGHT = 560

// The overlay is deliberately viewport-relative (a near-fullscreen chart) —
// no equivalent on the DS's fixed spacing/token scale.
const OVERLAY_CONTENT_CLASS = 'flex h-dvh w-full max-w-6xl flex-col overflow-hidden'

export function ChartCard({ title, headerExtra, children, compactHeight }: ChartCardProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Card className="gap-2 py-3">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="lbl lbl-fg">{title}</CardTitle>
          <div className="flex items-center gap-1">
            {headerExtra}
            <Button
              className="btn btn-icon"
              variant="ghost"
              size="icon-sm"
              onClick={() => setOpen(true)}
              aria-label={`Expand ${title}`}
              title="Expand"
            >
              <Maximize2 />
            </Button>
          </div>
        </CardHeader>
        <CardContent>{children(compactHeight)}</CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={OVERLAY_CONTENT_CLASS}>
          <DialogHeader className="flex-row items-center justify-between gap-2">
            <DialogTitle className="lbl lbl-fg">{title}</DialogTitle>
            {headerExtra && <div className="flex items-center gap-2 pr-6">{headerExtra}</div>}
          </DialogHeader>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {children(OVERLAY_CHART_HEIGHT)}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
