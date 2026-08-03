import type { Granularity, ProjectionsResponse, TransactionsResponse } from './types'

// The forecast endpoint. Defaults to the relative `api/forecast` this server
// exposes; override with VITE_API_BASE at build time when the SPA is mounted
// under a different path or proxied by another app (e.g. `/projections/data`).
const ENDPOINT = import.meta.env.VITE_API_BASE || 'api/forecast'

// Opt-in (VITE_AUTH_RELOAD=1) for deployments where the server sits behind an
// auth proxy (e.g. Cloudflare Access): an expired session answers with a login
// interstitial or a redirect instead of JSON. When on, that condition is
// surfaced as AuthExpiredError so the caller can reload to re-authenticate.
// Off (default) preserves the plain, direct-server behavior.
const AUTH_RELOAD =
  import.meta.env.VITE_AUTH_RELOAD === '1' || import.meta.env.VITE_AUTH_RELOAD === 'true'

/** Raised (only when VITE_AUTH_RELOAD is on) when the round-trip comes back as
 * an auth interstitial rather than the JSON payload. */
export class AuthExpiredError extends Error {
  constructor(message = 'Session expired') {
    super(message)
    this.name = 'AuthExpiredError'
  }
}

export interface FetchForecastParams {
  granularity: Granularity
  start: string // ISO date
  end: string // ISO date
}

/**
 * Fetches the full (unfiltered) forecast for one (granularity, range). This is
 * the only server round-trip: every filter (type / category / account /
 * currency) is applied in the browser, so narrowing the view costs nothing.
 */
export async function fetchForecast(params: FetchForecastParams): Promise<ProjectionsResponse> {
  // Static demo build (`vite build --mode demo`, deployed to GitHub Pages):
  // there's no server to call at all, so resolve straight to a fixture
  // instead of waiting on a request that can only fail.
  if (import.meta.env.MODE === 'demo') return loadFixture(params.granularity, true)

  const qs = new URLSearchParams({
    granularity: params.granularity,
    start: params.start,
    end: params.end,
  })

  let res: Response
  try {
    res = await fetch(`${ENDPOINT}?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
      // `redirect: 'manual'` so a cross-origin auth-proxy 302 → IdP hands back
      // an opaque-redirect Response we can detect, instead of throwing a
      // TypeError before we ever see it. Only under AUTH_RELOAD.
      ...(AUTH_RELOAD ? { redirect: 'manual' as RequestRedirect } : {}),
    })
  } catch (networkErr) {
    // Dev convenience: `npm run dev` with no server running falls back to the
    // synthetic fixtures. Compiled out of a production build.
    if (import.meta.env.DEV) return loadFixture(params.granularity, false)
    throw networkErr
  }

  // The other half of that dev convenience. With the `/api` dev proxy configured
  // (vite.config.ts), an unreachable server never reaches the catch above: Vite
  // answers the request itself with a 500, so `fetch` resolves and the fallback
  // was unreachable in exactly the situation it exists for. A 5xx under `npm run
  // dev` means "no server here" — take the fixtures. Compiled out of any
  // production build, where a 5xx is a real error and must surface as one.
  if (import.meta.env.DEV && res.status >= 500) {
    return loadFixture(params.granularity, false)
  }

  // Auth-proxy interception (session expired): an opaque redirect or a
  // non-JSON content-type means we got a login page, not the API — reload to
  // re-authenticate rather than surfacing a retryable error. Real 5xx-with-JSON
  // errors fall through to the normal error path below.
  if (AUTH_RELOAD) {
    if (res.type === 'opaqueredirect') {
      throw new AuthExpiredError('Redirected — auth session likely expired')
    }
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      throw new AuthExpiredError(`Unexpected content-type: ${contentType || '(none)'}`)
    }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    if (AUTH_RELOAD) throw new AuthExpiredError('Response was not valid JSON')
    throw new Error(`Server returned ${res.status} ${res.statusText} (not JSON)`)
  }

  if (!res.ok) {
    const detail =
      body && typeof body === 'object' && 'detail' in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).detail)
        : `Request failed: ${res.status} ${res.statusText}`
    throw new Error(detail)
  }

  return body as ProjectionsResponse
}

/**
 * Shared by the dev fallback (no server running under `npm run dev`) and the
 * static demo build. `demo` swaps the month/default fixture for the
 * character-driven "story" fixture (overdue backlog, needs-review, income +
 * expenses) so the public demo's first impression tells the product's story
 * rather than the plain dev-loop sample.
 */
async function loadFixture(granularity: Granularity, demo: boolean): Promise<ProjectionsResponse> {
  switch (granularity) {
    case 'day':
      return (
        (await import('../fixtures/projections-day.json')) as unknown as {
          default: ProjectionsResponse
        }
      ).default
    case 'year':
      return (
        (await import('../fixtures/projections-year.json')) as unknown as {
          default: ProjectionsResponse
        }
      ).default
    case 'month':
    default:
      if (demo) {
        return (
          (await import('../fixtures/projections-demo-story.json')) as unknown as {
            default: ProjectionsResponse
          }
        ).default
      }
      // `wide` exercises every status (upcoming / paid / received / done /
      // needs-review), so it's the more useful one to develop against.
      return (
        (await import('../fixtures/projections-wide.json')) as unknown as {
          default: ProjectionsResponse
        }
      ).default
  }
}

// ---------------------------------------------------------------------------
// Booked transactions — the Reports view
// ---------------------------------------------------------------------------

// Its own endpoint, and its own override, because a consumer that proxies the
// forecast under a custom path (VITE_API_BASE) has to be able to place this one
// too — it is a second route, not a query parameter on the first.
const TX_ENDPOINT = import.meta.env.VITE_TX_API_BASE || 'api/transactions'

export interface FetchTransactionsParams {
  start: string // ISO date
  end: string // ISO date
}

/**
 * Every booked transaction in one window. Like the forecast round-trip, this is
 * fetched unfiltered exactly once per window — grouping, ranking, filtering and
 * paging all happen in the browser, so changing any of them costs nothing.
 */
export async function fetchTransactions(
  params: FetchTransactionsParams,
): Promise<TransactionsResponse> {
  if (import.meta.env.MODE === 'demo') return loadTransactionsFixture()

  const qs = new URLSearchParams({ start: params.start, end: params.end })

  let res: Response
  try {
    res = await fetch(`${TX_ENDPOINT}?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
      ...(AUTH_RELOAD ? { redirect: 'manual' as RequestRedirect } : {}),
    })
  } catch (networkErr) {
    if (import.meta.env.DEV) return loadTransactionsFixture()
    throw networkErr
  }

  // With the `/api` dev proxy configured, an unreachable server does not raise a
  // network error — Vite answers 500 itself — so the catch above never fires in
  // the situation the fallback exists for. DEV only; in a production build a 5xx
  // is a real error and surfaces as one.
  if (import.meta.env.DEV && res.status >= 500) return loadTransactionsFixture()

  if (AUTH_RELOAD) {
    if (res.type === 'opaqueredirect') {
      throw new AuthExpiredError('Redirected — auth session likely expired')
    }
    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      throw new AuthExpiredError(`Unexpected content-type: ${contentType || '(none)'}`)
    }
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
    if (AUTH_RELOAD) throw new AuthExpiredError('Response was not valid JSON')
    throw new Error(`Server returned ${res.status} ${res.statusText} (not JSON)`)
  }

  if (!res.ok) {
    const detail =
      body && typeof body === 'object' && 'detail' in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).detail)
        : `Request failed: ${res.status} ${res.statusText}`
    throw new Error(detail)
  }

  return body as TransactionsResponse
}

/**
 * The synthetic ledger behind the dev fallback and the static demo build.
 *
 * It ignores the requested window — a fixture cannot answer an arbitrary range,
 * and interpolating one would be inventing financial data. So the same three
 * months come back whatever the period control says. Against a real server the
 * window is honoured exactly.
 */
async function loadTransactionsFixture(): Promise<TransactionsResponse> {
  return (
    (await import('../fixtures/transactions-demo.json')) as unknown as {
      default: TransactionsResponse
    }
  ).default
}
