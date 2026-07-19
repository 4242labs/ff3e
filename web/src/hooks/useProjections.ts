import { useCallback, useEffect, useState } from 'react'

import { AuthExpiredError, fetchForecast } from '@/lib/api'
import type { ProjectionsResponse } from '@/lib/types'

interface Query {
  granularity: 'day' | 'month' | 'year'
  start: string
  end: string
}

interface State {
  data: ProjectionsResponse | null
  loading: boolean
  error: string | null
}

// Once-per-window reload guard for VITE_AUTH_RELOAD. sessionStorage can throw
// (private modes / disabled storage), so every access is defensive; a failure
// degrades to "allow the reload" (the pre-guard behavior), never a crash.
const RELOAD_MARK = 'ff3e:last-auth-reload'
const RELOAD_MIN_MS = 10_000

function shouldReloadForAuth(): boolean {
  try {
    const now = Date.now()
    const last = Number(sessionStorage.getItem(RELOAD_MARK) || '0')
    if (now - last < RELOAD_MIN_MS) return false // reloaded just now → don't loop
    sessionStorage.setItem(RELOAD_MARK, String(now))
    return true
  } catch {
    return true
  }
}

function clearReloadMark(): void {
  try {
    sessionStorage.removeItem(RELOAD_MARK)
  } catch {
    /* ignore */
  }
}

/** Fetches once per (granularity, start, end) — never on a filter change, since
 * filtering happens entirely in the browser. */
export function useProjections(query: Query) {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null })
  const [nonce, setNonce] = useState(0)

  const load = useCallback(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    fetchForecast(query)
      .then((data) => {
        if (!cancelled) {
          clearReloadMark() // a good load clears the once-per-window reload guard
          setState({ data, loading: false, error: null })
        }
      })
      .catch((err) => {
        if (cancelled) return
        // Under VITE_AUTH_RELOAD, an expired auth-proxy session reloads the
        // page (bouncing through the login) instead of surfacing a retryable
        // error. Never thrown when the flag is off, so this is inert by default.
        if (err instanceof AuthExpiredError) {
          // Guard against an infinite reload loop: a proxy outage (an HTML
          // 502/503 page, a trailing-slash redirect) can be shape-identical to
          // an expired session. Reload at most once per window; if the very
          // next load fails the same way, fall through and surface the error
          // instead of hammering the server. Cleared on any successful load.
          if (shouldReloadForAuth()) {
            window.location.reload()
            return
          }
        }
        // Keep whatever `data` was already loaded (if any) so a failed
        // refresh/period-switch doesn't wipe a previously good render —
        // App.tsx shows it dimmed with an inline error, not a blank state.
        setState((s) => ({
          data: s.data,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        }))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.granularity, query.start, query.end, nonce])

  useEffect(() => load(), [load])

  const refetch = useCallback(() => setNonce((n) => n + 1), [])

  return { ...state, refetch }
}
