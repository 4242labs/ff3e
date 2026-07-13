import type { ComponentType } from 'react'
import { CalendarClock } from 'lucide-react'

import { BrandMark } from '@/components/Brand'
import { Wordmark } from '@/components/Wordmark'
import { ThemeSwitch } from '@/components/ThemeSwitch'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

interface NavItem {
  key: string
  label: string
  icon: ComponentType<{ className?: string }>
}

// One entry per view. FF3 Entropy ships a single view today (Forecast); adding
// another later is a new row here (+ a router when there's more than one).
const NAV: NavItem[] = [{ key: 'forecast', label: 'Forecast', icon: CalendarClock }]

export function AppSidebar({ activeView = 'forecast' }: { activeView?: string }) {
  return (
    <Sidebar collapsible="icon">
      {/*
       * Header spacing: 28/16/22 padding, 22px gap, a 42px mark; the collapsed
       * icon rail drops to 16/0/8 with a 26px mark. The FF3E wordmark's viewBox
       * is a tight cap-height box, so its CSS height IS its cap height (21px).
       */}
      <SidebarHeader className="gap-[22px] px-[16px] pt-[28px] pb-[22px] group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:pt-[16px] group-data-[collapsible=icon]:pb-[8px]">
        {/*
         * The lockup is CENTRED in the panel, not left-aligned, and links to
         * 42labs. Per the DS two-tone rule: the MARK carries the brand colour
         * (--logo), the WORDMARK stays neutral (--fg).
         */}
        <a
          href="https://42labs.io"
          target="_blank"
          rel="noreferrer"
          aria-label="FF3 Entropy — by 42labs"
          className="my-[12px] flex flex-row items-center justify-center gap-[8px] outline-none transition-opacity hover:opacity-80 focus-visible:opacity-80 group-data-[collapsible=icon]:m-0"
        >
          <BrandMark className="h-[42px] w-[42px] shrink-0 text-[var(--logo)] group-data-[collapsible=icon]:h-[26px] group-data-[collapsible=icon]:w-[26px]" />
          <Wordmark className="h-[21px] text-[var(--fg)] group-data-[collapsible=icon]:hidden" />
        </a>

        <ThemeSwitch />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Views</SidebarGroupLabel>
          <SidebarMenu>
            {NAV.map((item) => (
              <SidebarMenuItem key={item.key}>
                <SidebarMenuButton isActive={item.key === activeView} tooltip={item.label}>
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      {/*
       * Provenance footer — credit line (mirrors nordgrid.io), then a meta row
       * with the open-source licence and a Buy-me-a-coffee link. Hidden in the
       * collapsed icon rail. External links open in a new tab.
       */}
      <SidebarFooter className="items-center gap-[16px] border-t border-[var(--sidebar-border)] px-[16px] pt-[18px] pb-[40px] text-center text-[10px] leading-tight text-[var(--fg-muted)] group-data-[collapsible=icon]:hidden">
        {/* Row 1 — licence + source, icons only */}
        <div className="flex items-center justify-center gap-[16px]">
          <a
            href="https://github.com/4242labs/FF3-Entropy/blob/main/LICENSE"
            target="_blank"
            rel="noreferrer"
            aria-label="AGPL-3.0 licence"
            title="AGPL-3.0"
            className="transition-opacity hover:opacity-80"
          >
            <img src="opensource.svg" alt="AGPL-3.0 licence" className="h-[24px] w-[24px]" />
          </a>
          <a
            href="https://github.com/4242labs/FF3-Entropy"
            target="_blank"
            rel="noreferrer"
            aria-label="Source on GitHub"
            title="GitHub"
            className="transition-colors hover:text-[var(--fg)]"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-[23px] w-[23px]">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
          </a>
        </div>

        {/* Row 2 — credit */}
        <div className="flex flex-wrap items-center justify-center gap-x-[6px] gap-y-1 tracking-wide">
          <a
            href="https://tron.42labs.io/"
            target="_blank"
            rel="noreferrer"
            className="uppercase transition-colors hover:text-[var(--fg)]"
          >
            Built with TRON
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="https://42labs.io"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-[4px] uppercase transition-colors hover:text-[var(--fg)]"
          >
            <BrandMark className="h-[10px] w-[10px] text-[var(--logo)]" />
            42Labs
          </a>
        </div>

        {/*
         * Buy me a coffee — the 42labs asset, flat/transparent (no background).
         * The wordmark is theme-swapped so it stays legible: ink on the light
         * sidebar, white on dark (identical to the 42labs header). Only the
         * wordmark differs between the two files; the yellow cup is shared.
         */}
        <a
          href="https://buymeacoffee.com/42piratas"
          target="_blank"
          rel="noreferrer"
          aria-label="Buy me a coffee"
          className="transition-opacity hover:opacity-80"
        >
          <img src="buymeacoffee-ink.svg" alt="Buy me a coffee" className="h-[26px] w-auto dark:hidden" />
          <img src="buymeacoffee.svg" alt="Buy me a coffee" className="hidden h-[26px] w-auto dark:block" />
        </a>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
