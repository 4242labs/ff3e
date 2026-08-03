"""Entropy for Firefly III — HTTP server.

Two jobs, and no more:

  1. `GET /api/forecast` — run the forecast engine against your Firefly III
     instance and return the result as JSON.
  2. Serve the built SPA (`web/dist`) at `/`.

The server exists because a browser cannot talk to Firefly III directly: FF3
authenticates with a Personal Access Token (which must never sit in client-side
code) and it sends no permissive CORS headers. So this stays a thin, read-only
proxy — it holds the token, calls the FF3 REST API, and hands back JSON.

It writes NOTHING back to Firefly III.
"""
from __future__ import annotations

import datetime as dt
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

import forecast

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("ff3e")

app = FastAPI(title="Entropy for Firefly III", docs_url=None, redoc_url=None)


def _parse_date(s: Optional[str]) -> Optional[dt.date]:
    if not s:
        return None
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Not an ISO date: {s}")


@app.get("/healthz")
def healthz() -> dict:
    return {
        "ok": True,
        "firefly_iii_url": forecast.FIREFLY_III_URL or None,
        "token_configured": bool(forecast.FIREFLY_III_TOKEN),
    }


@app.get("/api/forecast")
def api_forecast(granularity: str = "month",
                 start: Optional[str] = None,
                 end: Optional[str] = None):
    """The forecast for one period. `granularity` is day|month|year; `start` and
    `end` are ISO dates (defaults: today → +6 months).

    Filtering (type / category / account / currency) is deliberately NOT done
    here — the client fetches the unfiltered period once and filters in the
    browser, so changing a filter costs no round-trip.
    """
    try:
        return forecast.build_projection(
            granularity=granularity,
            start=_parse_date(start),
            end=_parse_date(end),
        )
    except RuntimeError as e:  # missing config
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        log.exception("forecast failed")
        raise HTTPException(status_code=502, detail=f"Firefly III request failed: {e}")


@app.get("/api/transactions")
def api_transactions(start: str, end: str):
    """Every booked transaction in [start, end] — what the Reports view ranks.

    This is the ledger, not the forecast: no matching, no settlement, no
    projection. `start` and `end` are required ISO dates, because a report over
    an unstated window is meaningless.

    Filtering and grouping are the browser's, same as the forecast route: one
    unfiltered fetch per window, then every facet applied client-side.
    """
    s, e = _parse_date(start), _parse_date(end)
    if s is None or e is None:
        raise HTTPException(status_code=400, detail="start and end are required ISO dates")
    if e < s:
        s, e = e, s
    try:
        return forecast.build_transactions(start=s, end=e)
    except RuntimeError as exc:  # missing config
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        log.exception("transactions failed")
        raise HTTPException(status_code=502, detail=f"Firefly III request failed: {exc}")


# The SPA, if it has been built. `html=True` serves index.html at the mount
# root — that is all the "SPA fallback" this single-view app needs.
_DIST = Path(os.environ.get("WEB_DIST", Path(__file__).resolve().parent.parent / "web" / "dist"))
if _DIST.is_dir():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="web")
else:
    log.warning("web bundle not found at %s — API only. Run `npm run build` in web/.", _DIST)
