"use client"

import * as React from "react"
import { MenuIcon } from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

/**
 * Canonical application top bar.
 *
 * Two densities, and the choice is the shell's, not the page's:
 *
 * - `swiss` — the standalone bar for a product with no left rail. 76px above the
 *   shell breakpoint, 56px below it, and always a complete dark scope via
 *   `.band-dark`. One inversion per page: this bar is it.
 * - `compact` — 56px at every width, light, for a page that already has a dark
 *   left rail. It sits inside `SidebarInset` and follows the rail's edge.
 *
 * Slots are brand (left), destinations (centred on the bar, not on the space left
 * over beside the brand), and actions (right). Below the breakpoint the Swiss bar
 * never wraps to a second row — the destinations move into one 18rem left Sheet.
 *
 * The bar owns no labels, no routes, no account logic and no theme persistence.
 */

type TopBarVariant = "swiss" | "compact"
type TopBarLane = "lg" | "xl" | "2xl"

const LANE: Record<TopBarLane, string> = {
  lg: "max-w-(--w-lg)",
  xl: "max-w-(--w-xl)",
  "2xl": "max-w-(--w-2xl)",
}

const TopBarContext = React.createContext<{ variant: TopBarVariant }>({
  variant: "swiss",
})

function TopBar({
  variant = "swiss",
  lane = "xl",
  className,
  children,
  ...props
}: React.ComponentProps<"header"> & {
  variant?: TopBarVariant
  lane?: TopBarLane
}) {
  const ref = React.useRef<HTMLElement>(null)
  const [insideRail, setInsideRail] = React.useState(false)

  // A dark Swiss bar inside a dark rail is two inversions on one page, which the
  // system forbids. There is no prop for it because a product should not be able
  // to opt in: the composition is read from the DOM and refused.
  //
  // ponytail: DOM probe rather than importing useSidebar — a standalone Swiss
  // consumer would otherwise install the entire rail to render a top bar.
  React.useEffect(() => {
    setInsideRail(!!ref.current?.closest('[data-slot="sidebar-wrapper"]'))
  }, [])

  if (variant === "swiss" && insideRail) {
    return (
      <div
        ref={ref as React.RefObject<HTMLDivElement>}
        data-shell-invalid="true"
        role="alert"
        className="border border-border-control bg-surface p-4 text-sm text-fg"
      >
        Invalid shell composition: a standalone Swiss TopBar cannot render inside a
        left rail. Use <code>variant=&quot;compact&quot;</code> beside a rail, or drop
        the rail.
      </div>
    )
  }

  return (
    <TopBarContext.Provider value={{ variant }}>
      <header
        ref={ref}
        data-slot="top-bar"
        data-variant={variant}
        className={cn(
          "sticky top-0 z-20 flex w-full shrink-0 flex-col justify-center border-b border-border bg-surface",
          variant === "swiss"
            ? "band-dark h-(--h-bar-compact) shell:h-auto shell:min-h-(--h-bar-swiss)"
            : "h-(--h-bar-compact)",
          className
        )}
        {...props}
      >
        <div
          data-slot="top-bar-inner"
          className={cn(
            "relative mx-auto flex h-full w-full items-center gap-2 px-(--pad-x) shell:py-5 [[data-slot=sidebar-wrapper]_&]:mx-0",
            LANE[lane]
          )}
        >
          {children}
        </div>
      </header>
    </TopBarContext.Provider>
  )
}

/**
 * The rail's collapse control, and the only place it goes: first in the bar, hard
 * against the edge the rail occupies. A control that commands the left edge and sits
 * at the right one makes the user cross the whole bar to move something they are
 * already looking at.
 *
 * A slot rather than a sentence in the contract — the placement was unspecified once
 * and every product guessed differently, which is what the canon exists to stop.
 * Compose shadcn's `SidebarTrigger` (or any button) inside it.
 *
 * Pulled 6px left: the adopted trigger is a 28px box around a 16px glyph, so its
 * padding would otherwise inset the glyph from the lane the content below it uses.
 * What aligns is what the eye reads, which is the glyph, not the hit area.
 */
function TopBarRailLead({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="top-bar-rail-lead"
      className={cn("-ml-1.5 flex shrink-0 items-center", className)}
      {...props}
    />
  )
}

function TopBarBrand({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="top-bar-brand"
      className={cn("flex min-w-0 shrink-0 items-center gap-2", className)}
      {...props}
    />
  )
}

/**
 * The page's name, and only beside a rail. Where a rail is present the lockup lives
 * in the rail header, so the bar's lead slot is free — and what belongs in it is the
 * name of the view the user is looking at.
 *
 * This exists because it was missing. Without it the only lead slot was `TopBarBrand`,
 * so a compact bar that wanted a title had to put one in a slot named for a logo; the
 * shell fixture did exactly that and ended up showing a mark in the rail and a second
 * wordmark in the bar, a composition no product ships.
 *
 * The slot is optional, not mandatory. A control-heavy view may drop the name entirely
 * and open with filters and buttons instead — both readings are canon, and which one a
 * view takes is that view's call. What is not canon is a title in the brand slot.
 *
 * Renders an `h1` — the element for a name the bar already shows, not an instruction to
 * show one. A product that never names its views in the bar is not out of compliance: it puts
 * its one level-one heading in the content lane instead, `sr-only` if the surface reads better
 * without a visible title. What the canon refuses is a view name marked up as a styled `div`.
 */
function TopBarTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return (
    <h1
      data-slot="top-bar-title"
      className={cn(
        "m-0 min-w-0 truncate font-body text-xl leading-[1.4] font-semibold tracking-normal text-fg",
        className
      )}
      {...props}
    />
  )
}

/**
 * The destination row. Centred on the bar itself — absolute, not `justify-center`
 * on the remaining space, because a wide brand or a wide action cluster would
 * otherwise push a "centred" row visibly off centre and nobody would notice until
 * the two products sat side by side.
 */
function TopBarNav({ className, ...props }: React.ComponentProps<"nav">) {
  const { variant } = React.useContext(TopBarContext)
  return (
    <nav
      data-slot="top-bar-nav"
      aria-label="Main"
      className={cn(
        "items-center gap-1",
        variant === "swiss"
          ? "absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 shell:flex"
          : "flex",
        className
      )}
      {...props}
    />
  )
}

function TopBarNavLink({
  className,
  active,
  ...props
}: React.ComponentProps<"a"> & { active?: boolean }) {
  return (
    <a
      data-slot="top-bar-nav-link"
      data-active={active || undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        // A destination is machine-said, so it carries the DS Label role — the same
        // mono/500/12px/`--tk-label`/uppercase as `.sec-head` and `.marker`. 8px/12px of
        // padding around it, as Hiresling's `.swiss-viewbtn` has; `min-h-6` keeps the
        // target at WCAG 2.5.8's 24px floor when the label is the only content.
        "relative flex min-h-6 items-center px-3 py-2 whitespace-nowrap transition-colors",
        "font-mono text-xs leading-none font-medium tracking-label text-fg-2 uppercase",
        // The whole row takes the hover, the same shift the rail's rows take — house
        // rule 10. It was colour-only while `active` was a fill and the two were
        // indistinguishable; now that "you are here" is the rule, the two are not.
        "rounded-sm hover:bg-surface-muted hover:text-fg",
        "focus-visible:ring-2 focus-visible:ring-accent-focus focus-visible:outline-hidden focus-visible:ring-inset",
        "data-[active=true]:text-fg",
        "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-transparent",
        "data-[active=true]:after:bg-accent",
        className
      )}
      {...props}
    />
  )
}

function TopBarActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="top-bar-actions"
      className={cn("ml-auto flex min-w-0 shrink-0 items-center gap-2", className)}
      {...props}
    />
  )
}

/**
 * The sub-breakpoint destination menu. Radix Dialog underneath, so the focus
 * trap, the Escape and backdrop close, the removal from the tree while closed and
 * the focus return to the trigger are the primitive's behaviour, not four
 * hand-rolled effects that drift.
 */
function TopBarMenu({
  title = "Menu",
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetContent> & { title?: string }) {
  return (
    <Sheet>
      <SheetTrigger
        data-slot="top-bar-menu-trigger"
        aria-label="Open menu"
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-sm text-fg shell:hidden",
          "hover:bg-surface-muted",
          "focus-visible:ring-2 focus-visible:ring-accent-focus focus-visible:outline-hidden",
          className
        )}
      >
        <MenuIcon className="size-5" />
      </SheetTrigger>
      {/* From the right, because that is the edge the trigger is on: a panel that
          opens away from the hand that opened it makes the user cross the bar to
          read what they just asked for. */}
      <SheetContent
        side="right"
        className={cn("band-dark w-72 max-w-none gap-0 p-2 sm:max-w-none")}
        {...props}
      >
        {/* The panel's head is the Label role, on the rows' own padding so the head
            and the destinations under it share one left edge. */}
        <SheetTitle className="px-3 py-2 font-mono text-xs font-medium tracking-label text-fg-muted uppercase">
          {title}
        </SheetTitle>
        {/* `items-stretch`: a destination here is a row, so its hover is the row's
            full width rather than a tab-width patch inside it. */}
        <nav aria-label="Main" className="flex flex-col items-stretch gap-1">
          {children}
        </nav>
      </SheetContent>
    </Sheet>
  )
}

export {
  TopBar,
  TopBarRailLead,
  TopBarBrand,
  TopBarTitle,
  TopBarNav,
  TopBarNavLink,
  TopBarActions,
  TopBarMenu,
}
