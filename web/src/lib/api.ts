import type { Granularity, ProjectionsResponse } from './types'

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
