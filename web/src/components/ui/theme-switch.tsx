"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { Moon, Sun } from "lucide-react"

export type ThemeSwitchTheme = "light" | "dark"

/**
 * Canonical controlled Light/Dark selector. Consumers own persistence and token
 * application; this component owns the complete visual and ARIA contract.
 */
export function ThemeSwitch({
  theme,
  setTheme,
  className,
}: {
  theme: ThemeSwitchTheme
  setTheme: (theme: ThemeSwitchTheme) => void
  className?: string
}) {
  return (
    <ToggleGroup
      type="single"
      spacing={1}
      value={theme}
      onValueChange={(value) => {
        if (value) setTheme(value as ThemeSwitchTheme)
      }}
      aria-label="Theme"
      className={cn(
        "theme-switch grid w-full grid-cols-2 gap-1 rounded-sm border border-border bg-surface p-1 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:grid-cols-1 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:p-0",
        className
      )}
    >
      <ToggleGroupItem
        value="light"
        aria-label="Light theme"
        className="h-auto rounded-sm px-2 py-2 text-fg-muted group-data-[collapsible=icon]:size-full group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:data-[state=on]:hidden data-[state=on]:bg-surface-alt data-[state=on]:text-fg data-[state=off]:hover:bg-transparent data-[state=off]:hover:text-fg-muted data-[state=on]:hover:bg-surface-alt data-[state=on]:hover:text-fg"
      >
        <Sun className="size-3.5" aria-hidden="true" />
      </ToggleGroupItem>
      <ToggleGroupItem
        value="dark"
        aria-label="Dark theme"
        className="h-auto rounded-sm px-2 py-2 text-fg-muted group-data-[collapsible=icon]:size-full group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:data-[state=on]:hidden data-[state=on]:bg-surface-alt data-[state=on]:text-fg data-[state=off]:hover:bg-transparent data-[state=off]:hover:text-fg-muted data-[state=on]:hover:bg-surface-alt data-[state=on]:hover:text-fg"
      >
        <Moon className="size-3.5" aria-hidden="true" />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
