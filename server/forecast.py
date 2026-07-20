"""The forecast engine — a read-only look at what's coming.

Source of truth: your Firefly III **recurring transactions**. They can stay
paused (they never auto-post, so nothing is ever fabricated). Their occurrences
are projected forward across all three directions — withdrawal / deposit /
transfer, bounded by first_date / repeat_until / nr_of_repetitions (a finite
installment stops at N rather than forecasting forever).

An occurrence is marked paid by ACCOUNT, never by amount:
  • Mechanism A (dedicated account) — ordered-fill: each real payment identified
    by the commitment's account (or a `cmt:<slug>` tag) clears the earliest still-
    open occurrence, 1:1. Amount- and date-blind, so variable amounts and late /
    cross-month payments still count. A shared identifying account → flagged.
  • Mechanism B (credit-card installment) — fatura-driven: an occurrence belongs to
    the billing CYCLE it was charged in, and is settled iff that cycle was paid.
    Installments carry no per-occurrence transaction; they clear in aggregate.
    A cycle is a (close, due) pair read from the card account's notes in Firefly III
    — never computed, because a closing day is an issuer's choice and it moves.
    A card with no cycle rows clears nothing and is flagged `cycle_unknown`.

An occurrence still open once its date has passed is flagged for review — never
guessed. This module is pure read: it POSTs nothing to Firefly III and marks nothing.
"""
from __future__ import annotations

import logging
import os
import re
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
# An occurrence that matched a real transaction is CONFIRMED — it already
# happened and lives in Firefly III. Entropy complements Firefly III (it does
# not restate it), so a confirmed occurrence is not emitted: the payload is the
# OUTSTANDING set (upcoming + needs_review) only. The match still runs for every
# occurrence — it is the only way to know a paused recurrence became a real
# transaction, and it consumes the matched txn so a later occurrence can't
# re-claim it — we simply drop the item once it is confirmed.
_CONFIRMED = frozenset(s for s, _ in _DIR.values())  # {"paid", "received", "done"}
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
                "description": t.get("description"), "tags": t.get("tags") or [],
            })
    return flat


# ---------- classification helpers (Mechanism A / B) ----------

def _norm(s: Optional[str]) -> str:
    return (s or "").strip().lower()


def _ym(d: dt.date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _ident_key(rtype: str, src: Optional[str], dst: Optional[str]) -> tuple:
    """The account that identifies a commitment's payments — never the amount.
    Withdrawal → its payee (destination); deposit → its payer (source);
    transfer → the (source, destination) pair."""
    if rtype == "withdrawal":
        return ("W", _norm(dst))
    if rtype == "deposit":
        return ("D", _norm(src))
    return ("T", _norm(src), _norm(dst))


def _cmt_tag(tags) -> Optional[str]:
    """The commitment tag `cmt:<slug>` on a transaction, if any — the authoritative
    identity when an account is shared (a Firefly rule / the accounting agent sets it)."""
    for t in (tags or []):
        if isinstance(t, str) and t.lower().startswith("cmt:"):
            return t.lower()
    return None


def fetch_card_accounts() -> dict:
    """Credit-card accounts — ccAsset assets + liabilities — as
    `{lowercased name: [Cycle, ...]}`. Membership (`name in cards`) still answers
    "is this a card?"; the value carries its billing cycles.

    A recurrence whose source is a card settles via the monthly fatura (one transfer
    into the card), NOT via a per-occurrence transaction, so it needs Mechanism B."""
    out: dict = {}
    for atype in ("asset", "liabilities"):
        try:
            for ac in _paginate("/api/v1/accounts", {"type": atype, "limit": 100}):
                aa = ac.get("attributes", {})
                is_card = (atype == "liabilities"
                           or aa.get("account_role") == "ccAsset"
                           or aa.get("credit_card_type"))
                if is_card and aa.get("name"):
                    out[_norm(aa.get("name"))] = parse_cycles(aa.get("notes"))
        except Exception:
            log.warning("forecast: card-account fetch failed for type=%s", atype)
    return out


# ---------- billing cycles ----------
#
# A fatura states its own closing date, its due date and its total. Those are facts
# printed by the issuer, not a rule to be inferred: a closing day is the issuer's
# choice and it moves (one real card closed on the 10th one month and the 13th the
# next). So Entropy reads them, and refuses to guess when they are absent.
#
# They live in the card account's `notes` in Firefly III, one row per fatura:
#
#     cycle: close=2026-07-13 due=2026-07-20 total=26139.84
#
# `total` is optional and is used only to reconcile. Rows may be in any order.

_CYCLE_RE = re.compile(
    r"close\s*=\s*(\d{4}-\d{2}-\d{2})\s+due\s*=\s*(\d{4}-\d{2}-\d{2})"
    r"(?:\s+total\s*=\s*([0-9]+(?:\.[0-9]+)?))?",
    re.IGNORECASE,
)


class Cycle:
    """One billing cycle of one card: charges up to `close` are paid at `due`."""

    __slots__ = ("close", "due", "total")

    def __init__(self, close: dt.date, due: dt.date, total: Optional[float] = None):
        self.close, self.due, self.total = close, due, total

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Cycle(close={self.close}, due={self.due}, total={self.total})"


def parse_cycles(notes: Optional[str]) -> list:
    """Cycle rows out of an account's notes, sorted by closing date. Malformed or
    absent → empty list, which means "unknown" and clears nothing."""
    out: list = []
    for m in _CYCLE_RE.finditer(notes or ""):
        close, due = _parse_date(m.group(1)), _parse_date(m.group(2))
        if not close or not due or due < close:
            continue
        out.append(Cycle(close, due, float(m.group(3)) if m.group(3) else None))
    out.sort(key=lambda c: c.close)
    return out


def _settlement_dates(txns: list[dict], cards: dict) -> dict:
    """Per card, the fatura settlements as (date, txn_id), oldest first — transfers
    INTO the card account describing a payment. A refund, a balance adjustment or a
    reversal is not a settlement and clears nothing."""
    sd: dict = defaultdict(list)
    for t in txns:
        if t.get("type") != "transfer":
            continue
        d = _norm(t.get("destination"))
        if d not in cards or not t.get("date"):
            continue
        desc = _norm(t.get("description"))
        if "pagamento" not in desc and "fatura" not in desc:
            continue
        if "estorno" in desc or "reembolso" in desc:
            continue  # a reversal of a payment is not a payment
        sd[d].append((t["date"], t.get("id")))
    for k in sd:
        sd[k].sort(key=lambda x: x[0])
    return sd


def _settled_cycles(cycles: list, settlements: list) -> dict:
    """Which cycles a card's settlements paid → `{close_date: settlement_txn_id}`.

    Ordered fill: each settlement, oldest first, pays the earliest still-unpaid cycle
    it *could* have paid — one that had already closed (`close <= s`) and whose
    successor was not yet due (`s < due(next)`). Both bounds are calendar facts, not
    tunables: a fatura cannot be paid before it closes, and a payment made after the
    next fatura fell due is no longer attributable to this one.

    So: a payment late by anything up to a full cycle still counts; a minimum paid
    days before the full payment is absorbed (the next cycle has not closed, so the
    surplus settlement finds no home and is discarded); and an on-time payment cannot
    silently clear a cycle that was skipped.
    """
    paid: dict = {}
    for s_date, s_id in settlements:
        for i, c in enumerate(cycles):
            if c.close in paid:
                continue
            if c.close > s_date:
                break  # cycles are sorted; nothing later can have closed either
            nxt = cycles[i + 1] if i + 1 < len(cycles) else None
            if nxt is not None and s_date >= nxt.due:
                continue  # too late to be this cycle's payment
            paid[c.close] = s_id
            break
    return paid


def _cycle_of(d: dt.date, cycles: list):
    """The cycle a charge dated `d` was billed in — the first that closes on or after
    it. `None` when the table does not reach that far: unknown, never assumed."""
    for c in cycles:
        if c.close >= d:
            return c
    return None


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
    past too). Bounded by first_date / repeat_until / nr_of_repetitions.

    A finite series (nr_of_repetitions set — e.g. a card installment) fires exactly
    N times from first_date. We generate from first_date (NOT from `start`) so N can
    be counted from the true start of the series, truncate to N, THEN window-filter.
    Otherwise an installment would be forecast forever instead of stopping at N."""
    first = _parse_date(rec_attr.get("first_date"))
    if not first:
        return []
    until = _parse_date(rec_attr.get("repeat_until"))
    hi = end if until is None else min(end, until)
    if first > hi:
        return []
    out: set = set()
    for rep in rec_attr.get("repetitions", []):
        out |= _gen(rep.get("type") or "monthly", str(rep.get("moment") or ""),
                    int(rep.get("skip") or 0) + 1, first, first, hi)
    dates = sorted(out)
    nrep = rec_attr.get("nr_of_repetitions")
    if nrep is not None:               # honor a finite N (0 → an empty, spent series)
        dates = dates[:int(nrep)]
    return [d for d in dates if d >= start]


def _matches_A(t: dict, rtype: str, key: tuple, slug: Optional[str]) -> bool:
    """Does a real transaction belong to this Mechanism-A commitment?
    With a slug: only the txn tagged `cmt:<slug>`. Without: the identifying account,
    but NEVER a txn already tagged for some other commitment (a tagged payment is
    reserved for its own recurrence — an untagged sibling must not steal it)."""
    if t.get("type") != rtype:
        return False
    if slug:
        return _cmt_tag(t.get("tags")) == slug
    if _cmt_tag(t.get("tags")) is not None:
        return False
    return _ident_key(t.get("type"), t.get("source"), t.get("destination")) == key


def _remaining(a: dict, rtype: str, src, dst, cards: dict,
               hist_settle: dict, hist_txns: list, slug: Optional[str]) -> Optional[int]:
    """Installments still unpaid across the WHOLE finite series (window-independent):
    total N minus occurrences already settled, counted from payment history back to
    first_date — NOT the display window (which may start at `today`). None for
    open-ended recurrences."""
    nrep = a.get("nr_of_repetitions")
    if nrep is None:
        return None
    first = _parse_date(a.get("first_date"))
    if not first:
        return None
    full = _occurrences(a, first, dt.date(first.year + 30, first.month, 1))
    if not full:
        return 0
    if _norm(src) in cards and rtype == "withdrawal":
        # Same cycle logic as the payload, on the same settlement list — otherwise the
        # installment counter grows a second opinion about what was paid.
        cycles = cards.get(_norm(src)) or []
        settled = _settled_cycles(cycles, hist_settle.get(_norm(src), []))
        paid = 0
        for d in full:
            c = _cycle_of(d, cycles)
            if c is not None and c.close in settled:
                paid += 1
    else:
        key = _ident_key(rtype, src, dst)
        paid = min(sum(1 for t in hist_txns if _matches_A(t, rtype, key, slug)), len(full))
    return max(0, len(full) - paid)


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
    cards = fetch_card_accounts()

    # Remaining-count needs payment history back to each finite series' first_date,
    # independent of the display window (which may start at `today`). Fetch that once.
    firsts = [d for d in (_parse_date(r["attributes"].get("first_date")) for r in recs) if d]
    hist_start = min(firsts + [start]) if firsts else start
    hist_txns = fetch_transactions(hist_start, end) if hist_start < start else txns
    # ONE settlement list, built from the widest window and shared by the payload and
    # the remaining-count. Two lists would disagree about the oldest settlement, and
    # so about which cycles were ever paid.
    hist_settle = _settlement_dates(hist_txns, cards)

    # Index real transactions by identifying account for Mechanism A ordered-fill.
    tx_by_key: dict = defaultdict(list)
    for t in txns:
        tx_by_key[_ident_key(t["type"], t["source"], t["destination"])].append(t)
    for k in tx_by_key:
        tx_by_key[k].sort(key=lambda x: x["date"])

    def _slug_of(a: dict) -> Optional[str]:
        s = _norm(a.get("notes"))
        return s if s.startswith("cmt:") else None

    # Detect identifying accounts shared by >1 Mechanism-A commitment that is NOT
    # self-identified by a cmt slug: the account rule alone can't disambiguate them
    # → flag for we-need-to-talk (never guess). Slug-tagged commitments are exempt.
    keycount: dict = defaultdict(int)
    for r in recs:
        a = r["attributes"]; rtype = a.get("type", "withdrawal")
        if _slug_of(a):
            continue
        for tx in a.get("transactions", []):
            if _norm(tx.get("source_name")) in cards and rtype == "withdrawal":
                continue  # Mechanism B — no identifying account
            keycount[_ident_key(rtype, tx.get("source_name"), tx.get("destination_name"))] += 1

    used: set = set()  # txn ids consumed by ordered-fill (one payment clears one occurrence)
    # (card, cycle close) → amount of recurring charges this run considered settled.
    # Confirmed occurrences are dropped from the payload, so without this an
    # over-clear would be invisible; against the fatura total it also reconciles.
    cleared: dict = defaultdict(float)
    n_total = len(recs)
    n_active = sum(1 for r in recs if r["attributes"].get("active"))
    items: list[dict] = []
    for r in recs:
        a = r["attributes"]
        rtype = a.get("type", "withdrawal")
        if type_filter and rtype != type_filter:
            continue
        title = a.get("title") or a.get("description") or "(untitled)"
        slug = _slug_of(a)  # a cmt slug may be pinned in the recurrence notes
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

            occ_sorted = sorted(occ_dates)
            is_card = _norm(src) in cards and rtype == "withdrawal"
            key = _ident_key(rtype, src, dst)
            flags: list = []
            if (not is_card) and keycount.get(key, 0) > 1:
                flags.append("shared_account")   # >1 commitment on one account
            filled: dict = {}  # occurrence date → matched txn id (None for fatura)

            if is_card:
                # Mechanism B — an occurrence belongs to the cycle it was charged in,
                # and is settled iff that cycle's fatura was paid.
                mechanism = "fatura"
                cycles = cards.get(_norm(src)) or []
                if not cycles:
                    # No cycle rows for this card: which fatura a charge fell into is
                    # unknowable, so nothing is cleared and the item is surfaced.
                    flags.append("cycle_unknown")
                else:
                    settled = _settled_cycles(cycles, hist_settle.get(_norm(src), []))
                    for d in occ_sorted:
                        c = _cycle_of(d, cycles)
                        if c is None:
                            if "cycle_unknown" not in flags:
                                flags.append("cycle_unknown")
                        elif c.close in settled:
                            filled[d] = settled[c.close]
                            cleared[(_norm(src), c.close)] += amt
            else:
                # Mechanism A — ordered-fill: each identifying payment (amount- and
                # date-blind) clears the earliest still-open occurrence, 1:1.
                mechanism = "ordered_fill"
                avail = [t for t in tx_by_key.get(key, [])
                         if _matches_A(t, rtype, key, slug) and id(t) not in used]
                # More identifying payments than occurrences, with no cmt slug to
                # disambiguate → the account is noisy (e.g. ad-hoc payments to a payee
                # that also has a monthly commitment). Flag for we-need-to-talk.
                if (not slug) and len(avail) > len(occ_sorted):
                    flags.append("noisy_account")
                # Only auto-clear when attribution is unambiguous. A flagged account
                # (shared or noisy) can't be cleanly attributed, so leave its
                # occurrences OPEN — they surface for we-need-to-talk rather than being
                # silently marked paid and dropped from the outstanding set.
                if not flags:
                    n = min(len(avail), len(occ_sorted))
                    for d, t in zip(occ_sorted[:n], avail[:n]):
                        filled[d] = t.get("id")
                        used.add(id(t))

            remaining = _remaining(a, rtype, src, dst, cards, hist_settle, hist_txns, slug)
            for d in occ_sorted:
                if d in filled:
                    status = _DIR.get(rtype, ("paid",))[0]
                    matched_id = filled[d]
                elif d < today:
                    status = "needs_review"
                    matched_id = None
                else:
                    status = "upcoming"
                    matched_id = None
                # Emit the OUTSTANDING set only: confirmed occurrences already
                # live in Firefly III and are not restated here.
                if status in _CONFIRMED:
                    continue
                item = {
                    "date": d.isoformat(), "title": title, "type": rtype,
                    "amount": amt, "currency": cur, "source": src,
                    "destination": dst, "category": cat, "status": status,
                    "matched_txn_id": matched_id, "mechanism": mechanism,
                    "remaining": remaining,
                }
                if flags:
                    item["flags"] = list(flags)
                items.append(item)

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

    # Per-card cycle ledger: what was settled, by which payment, and how the
    # recurring charges cleared compare with the fatura's own total.
    card_summary = []
    for name, cycles in sorted(cards.items()):
        settled = _settled_cycles(cycles, hist_settle.get(name, []))
        rows = []
        for c in cycles:
            row = {"close": c.close.isoformat(), "due": c.due.isoformat(),
                   "settled_by": settled.get(c.close), "total": c.total,
                   "recurring_cleared": round(cleared.get((name, c.close), 0.0), 2)}
            if c.total is not None and c.close in settled:
                row["unreconciled"] = round(c.total - row["recurring_cleared"], 2)
            rows.append(row)
        card_summary.append({"account": name, "cycles": rows,
                             "cycles_known": bool(cycles)})

    return {
        "range": {"start": start.isoformat(), "end": end.isoformat(),
                  "granularity": gran},
        "filters": {"type": type_filter, "category": category,
                    "account": account, "currency": currency},
        "currencies": cur_summary,
        "periods": [periods[k] for k in order],
        "meta": {"recurrences_total": n_total, "active": n_active,
                 "match_window_days": MATCH_DAYS, "item_count": len(items),
                 "cards": card_summary},
    }
