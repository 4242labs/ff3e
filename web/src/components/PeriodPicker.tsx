import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@4242labs/design-system/components/button'
import { Calendar } from '@4242labs/design-system/components/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@4242labs/design-system/components/popover'
import { anchorToDate, toISO } from '@/lib/range'
import type { Granularity } from '@/lib/types'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Trigger width per granularity — fixed so the field never resizes as you
 * page. Month uses the 3-letter form, so every month is the same width. */
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
        <Button
          type="button"
          variant="ghost"
          className="barbtn"
          title={isCurrent ? 'Current period' : 'Jump to another period'}
          aria-expanded={open}
        >
          <span className="value num">{label}</span>
        </Button>
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
      <Button className="btn btn-icon" variant="ghost" size="icon-sm" onClick={onPrev} aria-label="Previous">
        <ChevronLeft />
      </Button>
      <span className="lbl lbl-fg num">{label}</span>
      <Button className="btn btn-icon" variant="ghost" size="icon-sm" onClick={onNext} aria-label="Next">
        <ChevronRight />
      </Button>
    </div>
  )
}
