import { useCallback, useEffect, useState } from 'react'

import { AuthExpiredError, fetchTransactions } from '@/lib/api'
import type { TransactionsResponse } from '@/lib/types'

interface Query {
  start: string
  end: string
}

interface State {
  data: TransactionsResponse | null
  loading: boolean
  error: string | null
}

/**
 * Fetches the window's booked transactions once per (start, end) — never on a
 * filter, view or page change, since all of those are applied in the browser.
 *
 * The forecast hook's auth-reload dance is deliberately NOT duplicated here: it
 * reloads the whole page to bounce through an identity provider, which is a
 * page-level concern and already handled by whichever view loaded first. An
 * expired session surfaces here as an ordinary error with a Retry.
 */
export function useTransactions(query: Query) {
  const [state, setState] = useState<State>({ data: null, loading: true, error: null })
  const [nonce, setNonce] = useState(0)

  const load = useCallback(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    fetchTransactions(query)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null })
      })
      .catch((err) => {
        if (cancelled) return
        // Keep whatever data was already loaded so a failed period switch shows
        // the last good report dimmed rather than a blank page.
        setState((s) => ({
          data: s.data,
          loading: false,
          error:
            err instanceof AuthExpiredError
              ? 'Session expired — reload to sign in again.'
              : err instanceof Error
                ? err.message
                : String(err),
        }))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.start, query.end, nonce])

  useEffect(() => load(), [load])

  const refetch = useCallback(() => setNonce((n) => n + 1), [])

  return { ...state, refetch }
}
