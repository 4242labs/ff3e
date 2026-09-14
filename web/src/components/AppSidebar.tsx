import type { ComponentType } from 'react'
import {
  BarChart3,
  CalendarClock,
  ChevronRight,
  Coffee,
  ExternalLink,
  Github,
  Info,
} from 'lucide-react'

import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { Wordmark } from '@/components/Wordmark'
import { ThemeSwitch } from '@/components/ThemeSwitch'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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
} from '@/components/ui/sidebar'
import type { AppView } from '@/lib/types'

type ViewItem = { key: AppView; label: string }
type LinkItem = { label: string; href: string; icon?: ComponentType<{ className?: string }> }

const VIEWS: ViewItem[] = [
  { key: 'forecast', label: 'Outstanding & Upcoming' },
  { key: 'reports', label: 'Reports' },
]

const PROJECT_LINKS: LinkItem[] = [
  { label: 'Source on GitHub', href: 'https://github.com/4242labs/ff3e', icon: Github },
  { label: 'AGPL-3.0 licence', href: 'https://github.com/4242labs/ff3e/blob/main/LICENSE', icon: Info },
  { label: 'Built with TRON', href: 'https://tron.42labs.io/', icon: ExternalLink },
  { label: '42labs', href: 'https://42labs.io', icon: ExternalLink },
  { label: 'Buy me a coffee', href: 'https://buymeacoffee.com/42piratas', icon: Coffee },
]

export function AppSidebar({
  activeView = 'forecast',
  onNavigate,
}: {
  activeView?: AppView
  onNavigate?: (view: AppView) => void
}) {
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
                          <SidebarMenuSubButton
                            asChild
                            isActive={item.key === activeView}
                          >
                            <Button type="button" variant="ghost" onClick={() => onNavigate?.(item.key)}>
                              <span>{item.label}</span>
                            </Button>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>

              <Collapsible asChild className="group/collapsible">
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton tooltip="Project">
                      <BarChart3 />
                      <span className="lbl">Project</span>
                      <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {PROJECT_LINKS.map((item) => (
                        <SidebarMenuSubItem key={item.href}>
                          <SidebarMenuSubButton asChild>
                            <a href={item.href} target="_blank" rel="noopener noreferrer">
                              <span>{item.label}</span>
                              <ExternalLink className="ml-auto" aria-hidden="true" />
                            </a>
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

      <SidebarFooter className="p-3">
        <ThemeSwitch />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
