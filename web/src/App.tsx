import { useState } from 'react'

import { AppSidebar } from '@/components/AppSidebar'
import { ForecastPage } from '@/components/ForecastPage'
import { ReportsPage } from '@/components/ReportsPage'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import type { AppView } from '@/lib/types'

const VIEW_KEY = 'entropy:view'

function loadView(): AppView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'reports' ? 'reports' : 'forecast'
  } catch {
    return 'forecast'
  }
}

/**
 * The shell: sidebar plus whichever page it has selected.
 *
 * Deliberately a piece of state rather than a router — there are two pages, both
 * mounted from the same bundle, and neither is deep-linkable today. When a third
 * arrives, or a report needs to be shareable by URL, this is the seam a router
 * goes into.
 *
 * Each page owns its own period and filters. That is on purpose: reading last
 * quarter's report should not move the forecast off this month.
 */
export default function App() {
  const [view, setView] = useState<AppView>(loadView)

  const changeView = (next: AppView) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      /* private mode / storage disabled — session-only is fine */
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar activeView={view} onNavigate={changeView} />
      <SidebarInset>{view === 'reports' ? <ReportsPage /> : <ForecastPage />}</SidebarInset>
    </SidebarProvider>
  )
}
