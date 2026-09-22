import { CalendarClock, ChevronRight, Github } from 'lucide-react'

import { BrandMark } from '@4242labs/design-system/components/brand-mark'
import { ThemeSwitch } from '@/components/ThemeSwitch'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@4242labs/design-system/components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@4242labs/design-system/components/collapsible'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from '@4242labs/design-system/components/sidebar'
import type { AppView } from '@/lib/types'

const VIEWS: { key: AppView; label: string }[] = [
  { key: 'forecast', label: 'Outstanding & Upcoming' },
  { key: 'charts', label: 'Charts' },
  { key: 'reports', label: 'Reports' },
]

export function AppSidebar({
  activeView = 'forecast',
  onNavigate,
}: {
  activeView?: AppView
  onNavigate?: (view: AppView) => void
}) {
  const { isMobile, setOpenMobile } = useSidebar()

  const navigate = (view: AppView) => {
    onNavigate?.(view)
    if (isMobile) setOpenMobile(false)
  }

  return (
    <Sidebar collapsible="icon" className="band-dark">
      <SidebarHeader className="items-center px-3 pt-8 pb-6 group-data-[collapsible=icon]:px-0! group-data-[collapsible=icon]:pt-8! group-data-[collapsible=icon]:pb-6!">
        <a
          href="https://42labs.io"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Entropy for Firefly III — by 42labs"
          className="flex max-h-(--h-rail-logo) max-w-full items-center justify-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <BrandMark className="size-8 shrink-0 group-data-[collapsible=icon]:size-6" />
          <Wordmark className="h-5 max-w-full text-logo-word group-data-[collapsible=icon]:hidden" />
        </a>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="p-3">
          <SidebarGroupContent>
            <SidebarMenu>
              <Collapsible asChild defaultOpen className="group/collapsible">
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip="Views">
                      <CalendarClock />
                      <span className="lbl">Views</span>
                      <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {VIEWS.map((item) => (
                        <SidebarMenuSubItem key={item.key}>
                          <SidebarMenuSubButton asChild isActive={item.key === activeView}>
                            <Button type="button" variant="ghost" onClick={() => navigate(item.key)}>
                              <span>{item.label}</span>
                            </Button>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-4 border-t border-sidebar-border p-3 group-data-[collapsible=icon]:gap-1">
        <div className="flex flex-col items-center gap-3 text-center group-data-[collapsible=icon]:hidden">
          <div className="flex items-center justify-center gap-4">
            <a
              href="https://github.com/4242labs/ff3e/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="AGPL-3.0 licence"
              className="rounded-sm text-fg-muted transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <img src="opensource.svg" alt="" className="size-6" />
            </a>
            <a
              href="https://github.com/4242labs/ff3e"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Source on GitHub"
              className="rounded-sm text-fg-muted transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <Github className="size-6" aria-hidden="true" />
            </a>
          </div>

          <p className="text-xs font-light uppercase tracking-mono text-fg-muted">
            <a className="hover:text-fg" href="https://tron.42labs.io/" target="_blank" rel="noopener noreferrer">Built with TRON</a>
            <span aria-hidden="true"> · </span>
            <a className="hover:text-fg" href="https://42labs.io" target="_blank" rel="noopener noreferrer">42labs</a>
          </p>

          <a
            href="https://buymeacoffee.com/42piratas"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm opacity-80 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <img src="buymeacoffee.svg" alt="Buy me a coffee" className="h-6 w-auto" />
          </a>
        </div>

        <ThemeSwitch />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
