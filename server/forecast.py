"""The forecast engine — a read-only look at what's coming.

Source of truth: your Firefly III **recurring transactions**. They can stay
paused (they never auto-post, so nothing is ever fabricated). Their occurrences
are projected forward across all three directions — withdrawal / deposit /
transfer. Each occurrence is given a STATUS by matching a real booked
transaction to it (same type + exact amount + same account, within a date
window). An occurrence still unmatched once its date has passed is flagged for
review — never guessed.

This module is pure read: it POSTs nothing to Firefly III and marks nothing.
"""
from __future__ import annotations

import logging
import os
import datetime as dt
from collections import defaultdict
from typing import Optional

import httpx

log = logging.getLogger("ff3e.forecast")

FIREFLY_III_URL = os.environ.get("FIREFLY_III_URL", "").rstrip("/")
FIREFLY_III_TOKEN = os.environ.get("FIREFLY_III_TOKEN", "")
MATCH_DAYS = int(os.environ.get("MATCH_DAYS", "5"))  # ± window for a match
# Optional: when Firefly III sits behind a Cloudflare Access service auth, these
# add the service-token headers to every request. Unset → not sent (the common
# case: a directly reachable Firefly III).
FIREFLY_CF_ACCESS_CLIENT_ID = os.environ.get("FIREFLY_CF_ACCESS_CLIENT_ID", "")
FIREFLY_CF_ACCESS_CLIENT_SECRET = os.environ.get("FIREFLY_CF_ACCESS_CLIENT_SECRET", "")
_UA = "ff3e/1.0"
_TIMEOUT = httpx.Timeout(30.0)


def _access_headers() -> dict:
    """Cloudflare Access service-token headers, only when both are configured."""
    if FIREFLY_CF_ACCESS_CLIENT_ID and FIREFLY_CF_ACCESS_CLIENT_SECRET:
        return {"CF-Access-Client-Id": FIREFLY_CF_ACCESS_CLIENT_ID,
                "CF-Access-Client-Secret": FIREFLY_CF_ACCESS_CLIENT_SECRET}
    return {}

# direction → (status-when-matched, sign) ; sign is for out/in aggregation
_DIR = {
    "withdrawal": ("paid", "out"),
    "deposit": ("received", "in"),
    "transfer": ("done", "xfer"),
}
_MN = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ---------- Firefly III connector (the ONLY coupling to FF3) ----------
#
# The whole data dependency is these two functions. Point them at another
# ledger and the rest of the engine (projection + matching + aggregation) is
# unchanged.

def _get(path: str, params: Optional[dict] = None) -> dict:
    if not FIREFLY_III_URL or not FIREFLY_III_TOKEN:
        raise RuntimeError(
            "FIREFLY_III_URL and FIREFLY_III_TOKEN must be set — see .env.example"
        )
    r = httpx.get(
        f"{FIREFLY_III_URL}{path}", params=params,
        headers={"Authorization": f"Bearer {FIREFLY_III_TOKEN}",
                 "Accept": "application/json", "User-Agent": _UA,
                 **_access_headers()},
        timeout=_TIMEOUT,
    )
    r.raise_for_status()
    return r.json()


def _paginate(path: str, params: dict) -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        d = _get(path, {**params, "page": page})
        out += d.get("data", [])
        pg = (d.get("meta") or {}).get("pagination") or {}
        if page >= int(pg.get("total_pages") or 1):
            break
        page += 1
    return out


def fetch_recurrences() -> list[dict]:
    return _paginate("/api/v1/recurrences", {"limit": 100})


def fetch_transactions(start: dt.date, end: dt.date) -> list[dict]:
    # widen the fetch by the match window so occurrences near the edges can match
    s = (start - dt.timedelta(days=MATCH_DAYS)).isoformat()
    e = (end + dt.timedelta(days=MATCH_DAYS)).isoformat()
    rows = _paginate("/api/v1/transactions", {"start": s, "end": e, "limit": 100})
    flat = []
    for it in rows:
        for t in it["attributes"].get("transactions", []):
            try:
                d = dt.date.fromisoformat((t.get("date") or "")[:10])
            except Exception:
                continue
            flat.append({
                "id": it.get("id"), "type": t.get("type"), "date": d,
                "amount": abs(float(t.get("amount") or 0)),
                "currency": t.get("currency_code"),
                "source": t.get("source_name"), "destination": t.get("destination_name"),
                "description": t.get("description"),
            })
    return flat


# ---------- occurrence extraction + matching ----------

def _parse_date(s: Optional[str]) -> Optional[dt.date]:
    try:
        return dt.date.fromisoformat((s or "")[:10])
    except Exception:
        return None


def _add_months(y: int, m: int, day: int, n: int) -> dt.date:
    import calendar
    m0 = m - 1 + n
    y2 = y + m0 // 12
    m2 = m0 % 12 + 1
    return dt.date(y2, m2, min(day, calendar.monthrange(y2, m2)[1]))


def _nth_weekday(year: int, month: int, week: int, weekday: int) -> Optional[dt.date]:
    import calendar
    days = [d for d in range(1, calendar.monthrange(year, month)[1] + 1)
            if dt.date(year, month, d).isoweekday() == weekday]
    if 1 <= week <= len(days):
        return dt.date(year, month, days[week - 1])
    return None


def _gen(rtype: str, moment: str, step: int, first: dt.date,
         lo: dt.date, hi: dt.date) -> set:
    """Generate occurrence dates for one repetition rule within [lo, hi].
    Handles Firefly's daily/weekly/monthly/ndom/yearly. Weekend modifiers are
    not applied (projection tolerance). Bounded iteration."""
    out: set = set()
    if rtype == "daily":
        d, n = first, 0
        while d <= hi and n < 4000:
            if d >= lo:
                out.add(d)
            d += dt.timedelta(days=step); n += 1
    elif rtype == "weekly":
        wd = int(moment) if moment.isdigit() else first.isoweekday()
        d = first
        while d.isoweekday() != wd:
            d += dt.timedelta(days=1)
        n = 0
        while d <= hi and n < 2000:
            if d >= lo:
                out.add(d)
            d += dt.timedelta(weeks=step); n += 1
    elif rtype == "monthly":
        day = int(moment) if moment.isdigit() else first.day
        i = 0
        while i < 1200:
            d = _add_months(first.year, first.month, day, i * step)
            if d > hi:
                break
            if d >= lo and d >= first:
                out.add(d)
            i += 1
    elif rtype == "ndom":  # "week,weekday"
        try:
            wk, wd = (int(x) for x in moment.split(","))
        except Exception:
            return out
        i = 0
        while i < 1200:
            m = _add_months(first.year, first.month, 1, i * step)
            d = _nth_weekday(m.year, m.month, wk, wd)
            if d and d > hi:
                break
            if d and d >= lo and d >= first:
                out.add(d)
            i += 1
    elif rtype == "yearly":
        d0 = _parse_date(moment) or first
        for y in range(lo.year, hi.year + 1):
            try:
                d = dt.date(y, d0.month, d0.day)
            except Exception:
                continue
            if lo <= d <= hi and d >= first:
                out.add(d)
    return out


def _occurrences(rec_attr: dict, start: dt.date, end: dt.date) -> list[dt.date]:
    """Compute occurrences over [start, end] from the recurrence rules — past AND
    future (Firefly's API only serves future ones, but paid/open needs the recent
    past too). Bounded by first_date / repeat_until."""
    first = _parse_date(rec_attr.get("first_date"))
    if not first:
        return []
    until = _parse_date(rec_attr.get("repeat_until"))
    lo = max(start, first)
    hi = end if until is None else min(end, until)
    if lo > hi:
        return []
    out: set = set()
    for rep in rec_attr.get("repetitions", []):
        out |= _gen(rep.get("type") or "monthly", str(rep.get("moment") or ""),
                    int(rep.get("skip") or 0) + 1, first, lo, hi)
    return sorted(out)


def _find_match(occ, txns: list[dict], used: set) -> Optional[dict]:
    """A real transaction matching this expected occurrence: same type + exact
    amount + same account(s), within ±MATCH_DAYS. Each txn is consumed once."""
    best = None
    for t in txns:
        if id(t) in used or t["type"] != occ["type"]:
            continue
        if abs(t["amount"] - occ["amount"]) > 0.01:
            continue
        if occ["source"] and t["source"] and t["source"].strip().lower() != occ["source"].strip().lower():
            continue
        if occ["destination"] and t["destination"] and t["destination"].strip().lower() != occ["destination"].strip().lower():
            continue
        delta = abs((t["date"] - occ["date"]).days)
        if delta > MATCH_DAYS:
            continue
        if best is None or delta < best[0]:
            best = (delta, t)
    if best:
        used.add(id(best[1]))
        return best[1]
    return None


def _period_key(d: dt.date, gran: str) -> tuple[str, str]:
    if gran == "day":
        return d.isoformat(), d.strftime("%b %-d, %Y")
    if gran == "year":
        return str(d.year), str(d.year)
    return f"{d.year}-{d.month:02d}", f"{_MN[d.month]} {d.year}"  # month default


def build_projection(granularity: str = "month",
                     start: Optional[dt.date] = None,
                     end: Optional[dt.date] = None,
                     today: Optional[dt.date] = None,
                     type_filter: Optional[str] = None,
                     category: Optional[str] = None,
                     account: Optional[str] = None,
                     currency: Optional[str] = None) -> dict:
    """Read-only projection payload. All filtering/matching happens here; the
    caller (HTTP route) just serialises the result."""
    today = today or dt.date.today()
    start = start or today
    end = end or (today + dt.timedelta(days=183))  # ~6 months
    gran = granularity if granularity in ("day", "month", "year") else "month"

    recs = fetch_recurrences()
    txns = fetch_transactions(start, end)
    used: set = set()

    n_total = len(recs)
    n_active = sum(1 for r in recs if r["attributes"].get("active"))
    items: list[dict] = []
    for r in recs:
        a = r["attributes"]
        rtype = a.get("type", "withdrawal")
        if type_filter and rtype != type_filter:
            continue
        title = a.get("title") or a.get("description") or "(untitled)"
        occ_dates = _occurrences(a, start, end)
        if not occ_dates:
            continue
        for tx in a.get("transactions", []):
            src = tx.get("source_name")
            dst = tx.get("destination_name")
            cat = tx.get("category_name")
            cur = tx.get("currency_code")
            amt = abs(float(tx.get("amount") or 0))
            if category and cat != category:
                continue
            # The account facet filters on the OWN (asset) side only — a
            # withdrawal's source, a deposit's destination, both ends of a
            # transfer (Firefly's account-type invariant). This keeps expense
            # (payee) / revenue (payer) names out of the "Asset Account" filter.
            if account:
                own = (src,) if rtype == "withdrawal" else \
                      (dst,) if rtype == "deposit" else (src, dst)
                if account not in own:
                    continue
            if currency and cur != currency:
                continue
            for d in occ_dates:
                occ = {"type": rtype, "amount": amt, "source": src,
                       "destination": dst, "date": d}
                match = _find_match(occ, txns, used)
                if match:
                    status = _DIR.get(rtype, ("paid",))[0]
                    matched_id = match["id"]
                elif d < today:
                    status = "needs_review"
                    matched_id = None
                else:
                    status = "upcoming"
                    matched_id = None
                items.append({
                    "date": d.isoformat(), "title": title, "type": rtype,
                    "amount": amt, "currency": cur, "source": src,
                    "destination": dst, "category": cat, "status": status,
                    "matched_txn_id": matched_id,
                })

    # aggregate
    periods: dict[str, dict] = {}
    order: list[str] = []
    currencies: dict[str, dict] = defaultdict(lambda: defaultdict(float))
    for it in items:
        d = dt.date.fromisoformat(it["date"])
        key, label = _period_key(d, gran)
        if key not in periods:
            periods[key] = {"key": key, "label": label, "items": [],
                            "totals": defaultdict(lambda: defaultdict(float)),
                            "status_counts": defaultdict(int)}
            order.append(key)
        p = periods[key]
        p["items"].append(it)
        flow = _DIR.get(it["type"], ("", "out"))[1]
        p["totals"][it["currency"]][flow] += it["amount"]
        p["status_counts"][it["status"]] += 1
        if flow in ("out", "in"):
            currencies[it["currency"]][flow] += it["amount"]

    for k in periods:
        periods[k]["items"].sort(key=lambda x: x["date"])
        periods[k]["totals"] = {c: dict(v) for c, v in periods[k]["totals"].items()}
        periods[k]["status_counts"] = dict(periods[k]["status_counts"])

    cur_summary = {}
    for c, v in currencies.items():
        cur_summary[c] = {"out": v.get("out", 0.0), "in": v.get("in", 0.0),
                          "net": v.get("in", 0.0) - v.get("out", 0.0)}

    return {
        "range": {"start": start.isoformat(), "end": end.isoformat(),
                  "granularity": gran},
        "filters": {"type": type_filter, "category": category,
                    "account": account, "currency": currency},
        "currencies": cur_summary,
        "periods": [periods[k] for k in order],
        "meta": {"recurrences_total": n_total, "active": n_active,
                 "match_window_days": MATCH_DAYS, "item_count": len(items)},
    }
