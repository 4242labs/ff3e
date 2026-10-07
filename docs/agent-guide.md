# Agent guide: Entropy for Firefly III (`ff3e`, vendored as `/entropy/`)

Five-section guide for Alfred before it first touches Entropy (ff3e) in a session (42L-2118
REQ-D1). Credentials referenced here live in `agents/alfred/instance.md` (`alfred-meta`) —
never repeated inline.

## What it does for Alfred

Entropy is a read-only reporting engine, not a separately-deployed service: this repo
(`4242labs/ff3e`) is the pinned upstream, vendored into `alfred-app` via `git subtree` at
`services/classifier/vendor/ff3e/`, and served **inside the same classifier app** at
`/entropy/` (the SPA) and `/projections/data` (its API base) — see `app.py`'s "entropy
(Projections) SPA" block. It answers two questions Firefly's own UI doesn't surface directly:
what's outstanding and upcoming (projected recurring occurrences not yet matched), and what
actually happened over a window (booked transactions, ranked). It writes nothing back to
Firefly III, ever — there is no write path in the engine at all. Alfred's own touchpoint with
ff3e's internals is narrower still: `receivables.py` reuses Entropy's
`settles:<slug>:<YYYY-MM>` tag convention (`vendor/ff3e/server/forecast.py`) as the claim
mechanism for matching a landed deposit to an open receivable; `coming_due.py` and
`settles_tag.py` import the vendored `forecast.py` module directly rather than calling it over
HTTP, while `fatura_ingest.py` only documents (in comments) the installment-tag convention it
writes, without importing `forecast.py` itself. Alfred must never invent a different tag shape
or write a `settles:`/`cmt:`/instalment tag from anywhere but those existing modules.

## Health check

```bash
curl -s https://alfred.42piratas.com/entropy/ -o /dev/null -w '%{http_code}\n'
```

Behind the same Cloudflare Access as the rest of the classifier app — a bare `curl` 302s to the
CF login page, which is expected and not a failure on its own; running it with full CF Access
credentials to confirm a real `200` requires the operator's per-run approval (O-12). To see the
**standalone upstream** (not Alfred's live data — 100% synthetic demo fixtures, no Firefly
instance behind it), `https://ff3e.42labs.io` is a static GitHub Pages build, useful only for
checking the upstream UI/engine itself is intact, never for Alfred's real numbers.

## Common failures

| Symptom | Cause | Fix |
|:--|:--|:--|
| A receivable never shows as settled in the digest even after the deposit landed | `match_deposit` found a mismatch (partial payment, same-amount collision, wrong amount) and deliberately left it open rather than guess | check the receivable's own alert/status, not Entropy — `receivables.py` never auto-settles on an ambiguous match (42L-1160 §6) |
| `/entropy/` 404s on a sub-path | the SPA has no client-side router; only the exact mount root and `/entropy/assets/*` are served, `html=True` fallback only applies at the mount root | reload at `/entropy/` itself, don't deep-link |
| Outstanding/Upcoming view looks stale | the SPA fetches its window once per page load; it doesn't poll | reload the page — there is no cache-invalidation bug to chase here |
| A ff3e upstream PR "isn't live" after merging to `main` here | this repo being merged doesn't update `alfred-app`'s vendored copy by itself | the cutover is a separate `git subtree pull` into `alfred-app/services/classifier/vendor/ff3e` — an engineer task, not something Alfred triggers |

## Never

- Never write a `settles:<slug>:<YYYY-MM>`, `cmt:`, or instalment tag from anywhere but the
  existing modules (`receivables.py`, `settles_tag.py`, `fatura_ingest.py`) that already own
  that convention — Entropy's view and the daily digest both read those tags as ground truth.
- Never treat the public `ff3e.42labs.io` demo as Alfred's real numbers — it is 100% synthetic.
- Never ask Entropy to write anything to Firefly — it has no write path; a correction belongs in
  Firefly directly (`agent-guide-firefly.md` in `alfred-app`), never routed through this engine.

## Deeper docs

- `README.md` §How it fits together — the server-holds-the-token design and the two read-only
  endpoints the vendored engine exposes
- `alfred-app/services/classifier/app.py` — the `/entropy` mount and `_ENGINE_DIR` sys.path wiring
- `alfred-app/services/classifier/receivables.py` — the receivable lifecycle and the `settles:`
  tag reuse
