import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatDate } from '@/lib/format'
import { anchorToDate, toISO } from '@/lib/range'
import { cn } from '@/lib/utils'

export interface DateRangePickerProps {
  start: string // ISO
  end: string // ISO
  onChange: (range: { start: string; end: string }) => void
}

/**
 * The custom-period control: two single-date calendars, one per end of the
 * window. Deliberately two separate pickers rather than a drag-select range —
 * the two ends are usually chosen months apart, and a range calendar makes the
 * far end a scrolling exercise.
 *
 * Reversing the two is allowed here and normalised downstream (`reportRange`),
 * so picking the end first is not an error state to recover from.
 */
export function DateRangePicker({ start, end, onChange }: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-1">
      <DateField
        value={start}
        label="From"
        onPick={(iso) => onChange({ start: iso, end })}
      />
      <span className="text-xs text-muted-foreground" aria-hidden="true">
        →
      </span>
      <DateField value={end} label="To" onPick={(iso) => onChange({ start, end: iso })} />
    </div>
  )
}

function DateField({
  value,
  label,
  onPick,
}: {
  value: string
  label: string
  onPick: (iso: string) => void
}) {
  const [open, setOpen] = useState(false)
  const date = anchorToDate(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label} date`}
          title={`${label}: ${formatDate(value)}`}
          className={cn(
            'w-32 rounded-md px-2 py-1 text-center text-sm font-medium tabular-nums text-foreground transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
          )}
        >
          {formatDate(value)}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="center">
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date}
          onSelect={(d) => {
            if (!d) return
            onPick(toISO(d))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
