"use client"

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const ALIGN = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
} as const

const STRIP = "flex items-center overflow-hidden rounded-sm border border-border [&_svg]:text-fg-muted"

/**
 * Where the pager sits on the row is the PRODUCT's call, not the canon's.
 *
 * It shipped hard-wired to the trailing edge, which reads on a wide table whose last
 * column already ends there and reads as an orphan under a centred lane or a card grid.
 * There is no house rule to appeal to here — the Swiss style governs what the control
 * looks like, not where a page puts it — so the DS offers the three answers and takes
 * none. `end` stays the default because that is what every current consumer renders.
 *
 * How many rows to a page is the READER's call, but only where it changes something.
 * Pass `sizes` and `onLimitChange` together and a second strip appears beside the pager;
 * leave them out and there is none, which is right for a fixed card grid, where the size
 * changes nothing but how far you scroll. Picking a size returns to the first page: the
 * rows under the reader are about to be different rows either way, and page 7 of 10 has
 * no honest equivalent at the new size.
 */
export function Pagination({
  offset,
  limit,
  total,
  onOffsetChange,
  sizes,
  onLimitChange,
  align = "end",
  className,
}: {
  offset: number
  limit: number
  total: number
  onOffsetChange: (offset: number) => void
  sizes?: number[]
  onLimitChange?: (limit: number) => void
  align?: "start" | "center" | "end"
  className?: string
}) {
  const resizable = sizes && sizes.length > 0 && onLimitChange
  const pages = Math.max(1, Math.ceil(total / limit))
  const page = Math.min(pages, Math.floor(offset / limit) + 1)
  // Nothing to page through and nothing to resize — the controls would only be furniture.
  if (total <= (resizable ? Math.min(...sizes) : limit)) return null

  const go = (next: number) => onOffsetChange((Math.min(pages, Math.max(1, next)) - 1) * limit)
  return (
    <div className={cn("mt-7 flex flex-wrap items-center gap-3", ALIGN[align], className)}>
      <nav aria-label="Pages" className={STRIP}>
        <PageCell label="First page" disabled={page <= 1} onClick={() => go(1)}><ChevronsLeft className="size-3.5" /></PageCell>
        <PageCell label="Previous page" disabled={page <= 1} onClick={() => go(page - 1)}><ChevronLeft className="size-3.5" /></PageCell>
        <span aria-live="polite" className="inline-flex h-7 items-center justify-center border-x border-border px-4 font-mono text-xs whitespace-nowrap">{page} of {pages}</span>
        <PageCell label="Next page" disabled={page >= pages} onClick={() => go(page + 1)}><ChevronRight className="size-3.5" /></PageCell>
        <PageCell label="Last page" disabled={page >= pages} onClick={() => go(pages)}><ChevronsRight className="size-3.5" /></PageCell>
      </nav>
      {resizable ? (
        <nav aria-label="Rows per page" className={STRIP}>
          {sizes.map((size) => (
            <PageCell
              key={size}
              label={`${size} per page`}
              aria-current={size === limit ? "true" : undefined}
              className="w-auto min-w-8 px-2 font-mono text-xs text-fg-muted tabular-nums aria-[current=true]:bg-surface-muted aria-[current=true]:text-fg"
              onClick={() => {
                onLimitChange(size)
                onOffsetChange(0)
              }}
            >
              {size}
            </PageCell>
          ))}
        </nav>
      ) : null}
    </div>
  )
}

function PageCell({ label, className, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      className={cn("rounded-none", className)}
      {...props}
    />
  )
}
