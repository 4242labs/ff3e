import { useState } from 'react'
import { Check, PlusCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export interface FacetOption {
  value: string
  label: string
  /** Compact form shown in the chip badge when selected. The full `label` is
   * still what the dropdown list (and search) uses. Keeps long options like
   * a long option like "Due this month" from blowing out the chip width. */
  short?: string
}

export interface FacetedFilterProps {
  title: string
  options: FacetOption[]
  selected: string[]
  onChange: (next: string[]) => void
  /** Single-select (exactly one value, always set) — used by the View switch.
   * Renders a solid chip instead of the dashed "add a filter" affordance, and
   * picking an option replaces the selection and closes the popover. */
  single?: boolean
}

/**
 * shadcn "Tasks" faceted-filter chip: quiet dashed button until something is
 * selected, then the chosen values ride inside the chip as badges.
 */
export function FacetedFilter({
  title,
  options,
  selected,
  onChange,
  single = false,
}: FacetedFilterProps) {
  const [open, setOpen] = useState(false)
  const selectedSet = new Set(selected)

  const toggle = (value: string) => {
    if (single) {
      onChange([value])
      setOpen(false)
      return
    }
    onChange(selectedSet.has(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-8',
            // A fixed-width chip: an active multi-select facet is marked by
            // a filled state alone, never by riding its picked value(s)
            // inline — that grows the chip and reflows the whole filter row.
            // `bg-secondary`/`text-secondary-foreground` is this app's own
            // "on" recipe (matches the GROUP toggle and the Dashboard/Data
            // switch) — NOT `accent`: bridge.css intentionally shadows the
            // shadcn `accent` token with `--accent-soft`, a soft hover-fill
            // meant as a background tint, not a text/border colour, so
            // `text-accent`/`border-accent` render almost invisibly here.
            !single && (selected.length > 0 ? 'bg-secondary text-secondary-foreground' : 'border-dashed'),
          )}
        >
          {!single && <PlusCircle className="mr-2 h-4 w-4" />}
          {title}
          {single && selected.length > 0 && (
            <>
              <Separator orientation="vertical" className="mx-2 h-4" />
              {options
                .filter((o) => selectedSet.has(o.value))
                .map((o) => (
                  <Badge
                    variant="secondary"
                    key={o.value}
                    className="mr-1 rounded-sm px-1 font-normal"
                  >
                    {o.short ?? o.label}
                  </Badge>
                ))}
            </>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          {/* Always rendered: cmdk keyboard navigation (arrows + Enter) hangs
              off this input, so dropping it for "short lists" silently makes
              the popover mouse-only. */}
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selectedSet.has(option.value)
                return (
                  <CommandItem
                    key={option.value}
                    onSelect={() => toggle(option.value)}
                    className="cursor-pointer"
                  >
                    <div
                      className={cn(
                        'mr-2 flex h-4 w-4 items-center justify-center border border-primary',
                        single ? 'rounded-full' : 'rounded-sm',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'opacity-50 [&_svg]:invisible',
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </div>
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>

            {!single && selected.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => onChange([])}
                    className="cursor-pointer justify-center text-center"
                  >
                    Clear
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
