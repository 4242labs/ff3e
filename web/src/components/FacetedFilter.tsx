import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

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
import { cn } from '@/lib/utils'

export interface FacetOption {
  value: string
  label: string
  short?: string
}

export interface FacetedFilterProps {
  title: string
  options: FacetOption[]
  selected: string[]
  onChange: (next: string[]) => void
  single?: boolean
  disabled?: boolean
}

export function FacetedFilter({
  title,
  options,
  selected,
  onChange,
  single = false,
  disabled = false,
}: FacetedFilterProps) {
  const [open, setOpen] = useState(false)
  const selectedSet = new Set(selected)
  const selectedOptions = options.filter((option) => selectedSet.has(option.value))
  const selectedValue = selectedOptions[0]?.short ?? selectedOptions[0]?.label

  const toggle = (value: string) => {
    if (single) {
      onChange([value])
      setOpen(false)
      return
    }
    onChange(selectedSet.has(value) ? selected.filter((item) => item !== value) : [...selected, value])
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="barbtn"
          disabled={disabled}
          aria-expanded={open}
        >
          <span>{title}</span>
          {single && selectedValue ? <span className="value">{selectedValue}</span> : null}
          {!single && selected.length > 0 ? <span className="count">{selected.length}</span> : null}
          <ChevronDown aria-hidden="true" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-64 p-0" align="start" sideOffset={8}>
        <Command>
          <CommandInput placeholder={`Search ${title.toLowerCase()}`} aria-label={`Search ${title.toLowerCase()}`} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selectedSet.has(option.value)
                return (
                  <CommandItem key={option.value} onSelect={() => toggle(option.value)}>
                    <span
                      className={cn(
                        'flex size-4 items-center justify-center rounded-sm border border-border-control',
                        isSelected ? 'bg-accent-solid text-accent-on' : '[&_svg]:invisible',
                      )}
                      aria-hidden="true"
                    >
                      <Check />
                    </span>
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {!single && selected.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => onChange([])} className="justify-center">
                    Clear {title.toLowerCase()}
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
