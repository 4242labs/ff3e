import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { anchorToDate, toISO } from '@/lib/range'
import { cn } from '@/lib/utils'
import type { Granularity } from '@/lib/types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Trigger width per granularity — fixed so the field never resizes as you
 * page. Month uses the 3-letter form, so every month is the same width. */
const TRIGGER_WIDTH: Record<Granularity, string> = {
  day: 'w-34',
  month: 'w-24',
  year: 'w-18',
}

export interface PeriodPickerProps {
  granularity: Granularity
  anchor: string
  label: string
  isCurrent: boolean
  onPick: (iso: string) => void
  onToday: () => void
}

/** Clicking the period label opens a picker appropriate to the granularity:
 * a date calendar (Day), a month grid (Month), a year grid (Year). */
export function PeriodPicker({
  granularity,
  anchor,
  label,
  isCurrent,
  onPick,
  onToday,
}: PeriodPickerProps) {
  const [open, setOpen] = useState(false)
  const anchorDate = anchorToDate(anchor)
  const anchorYear = anchorDate.getFullYear()

  // Year shown by the month grid / first year of the year grid's page.
  const [gridYear, setGridYear] = useState(anchorYear)
  const [yearPage, setYearPage] = useState(anchorYear - 5)

  // Re-centre the grids on the current anchor each time the popover opens.
  useEffect(() => {
    if (open) {
      setGridYear(anchorYear)
      setYearPage(anchorYear - 5)
    }
  }, [open, anchorYear])

  const pick = (iso: string) => {
    onPick(iso)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={isCurrent ? 'Current period' : 'Jump to another period'}
          className={cn(
            'rounded-md px-2 py-1 text-center text-sm font-medium tabular-nums transition-colors hover:bg-accent hover:text-accent-foreground',
            TRIGGER_WIDTH[granularity],
            isCurrent ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {label}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="center">
        {granularity === 'day' && (
          <Calendar
            mode="single"
            selected={anchorDate}
            defaultMonth={anchorDate}
            onSelect={(d) => d && pick(toISO(d))}
          />
        )}

        {granularity === 'month' && (
          <div className="p-3">
            <GridNav
              label={String(gridYear)}
              onPrev={() => setGridYear((y) => y - 1)}
              onNext={() => setGridYear((y) => y + 1)}
            />
            <div className="mt-3 grid grid-cols-3 gap-1">
              {MONTHS.map((m, i) => {
                const selected = gridYear === anchorYear && i === anchorDate.getMonth()
                return (
                  <Button
                    key={m}
                    variant={selected ? 'default' : 'ghost'}
                    size="sm"
                    className="h-8 w-full font-normal"
                    onClick={() => pick(`${gridYear}-${String(i + 1).padStart(2, '0')}-01`)}
                  >
                    {m}
                  </Button>
                )
              })}
            </div>
          </div>
        )}

        {granularity === 'year' && (
          <div className="p-3">
            <GridNav
              label={`${yearPage}–${yearPage + 11}`}
              onPrev={() => setYearPage((y) => y - 12)}
              onNext={() => setYearPage((y) => y + 12)}
            />
            <div className="mt-3 grid grid-cols-3 gap-1">
              {Array.from({ length: 12 }, (_, i) => yearPage + i).map((y) => (
                <Button
                  key={y}
                  variant={y === anchorYear ? 'default' : 'ghost'}
                  size="sm"
                  className="h-8 w-full font-normal tabular-nums"
                  onClick={() => pick(`${y}-01-01`)}
                >
                  {y}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full font-normal"
            onClick={() => {
              onToday()
              setOpen(false)
            }}
          >
            Today
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function GridNav({
  label,
  onPrev,
  onNext,
}: {
  label: string
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <Button variant="outline" size="icon" className="size-7" onClick={onPrev} aria-label="Previous">
        <ChevronLeft className="size-4" />
      </Button>
      <span className="text-sm font-medium tabular-nums">{label}</span>
      <Button variant="outline" size="icon" className="size-7" onClick={onNext} aria-label="Next">
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}
