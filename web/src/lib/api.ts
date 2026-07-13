import type { Granularity, ProjectionsResponse } from './types'

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
    res = await fetch(`api/forecast?${qs.toString()}`, {
      headers: { Accept: 'application/json' },
    })
  } catch (networkErr) {
    // Dev convenience: `npm run dev` with no server running falls back to the
    // synthetic fixtures. Compiled out of a production build.
    if (import.meta.env.DEV) return loadFixture(params.granularity, false)
    throw networkErr
  }

  let body: unknown
  try {
    body = await res.json()
  } catch {
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
