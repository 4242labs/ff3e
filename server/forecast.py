"""The forecast engine — a read-only look at what's coming.

Source of truth: your Firefly III **recurring transactions**. They can stay
paused (they never auto-post, so nothing is ever fabricated). Their occurrences
are projected forward across all three directions — withdrawal / deposit /
transfer, bounded by first_date / repeat_until / nr_of_repetitions (a finite
installment stops at N rather than forecasting forever).

An occurrence is marked settled deterministically, never guessed:
  • Mechanism A (non-card commitment) — settled by an EXPLICIT PERIOD TAG on the
    real transaction: `settles:<slug>:<YYYY-MM>`, where `<slug>` is the
    commitment's human-stable id pinned in its recurrence notes as `cmt:<slug>`,
    and `<YYYY-MM>` is the month the payment is FOR (not the date it was paid).
    The engine is a pure lookup: an occurrence for month M is PAID iff a
    transaction tagged `settles:<slug>:M` exists. Late / advance / lump all encode
    truth in the tag, decoupled from the payment date, so the verdict is identical
    at any display-window width. Nothing is inferred: an occurrence with no tag and
    no acknowledgement, whose date has passed, is `needs_review`; a month knowingly
    accepted as unpaid carries `ack-gap:<slug>:<M>` and renders `acknowledged_gap`.
  • Mechanism B (credit-card installment) — fatura-driven: an occurrence belongs to
    the billing CYCLE it was charged in, and is settled iff that cycle was paid.
    Installments carry no per-occurrence transaction; they clear in aggregate.
    A cycle is a (close, due) pair read from the card account's notes in Firefly III
    — never computed, because a closing day is an issuer's choice and it moves.
    A card with no cycle rows clears nothing and is flagged `cycle_unknown`.

The two mechanisms are mutually exclusive by construction: a card recurrence never
enters the tag path (asserted), so an installment can never clear via both a cycle
and a `settles:` tag. All settlement TAGS are written onto Firefly III by the Alfred
valet (from a bank statement / fatura, only when the period is certain) — never by
this engine. This module is pure read: it POSTs nothing and marks nothing.
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
MATCH_DAYS = int(os.environ.get("MATCH_DAYS", "5"))  # ± window widening on the fetch
# A date far enough ahead to regenerate a whole finite installment series (it is
# truncated by nr_of_repetitions, so the horizon only has to exceed the last
# occurrence) when numbering installments 1..N regardless of the display window.
_FAR_HORIZON = dt.date(2100, 1, 1)
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
# An occurrence that is settled is CONFIRMED — it already happened and lives in
# Firefly III. Entropy complements Firefly III (it does not restate it), so a
# confirmed occurrence is not emitted: the payload is the OUTSTANDING set
# (upcoming + needs_review + acknowledged_gap) only. We simply drop the item once
# it is confirmed. `acknowledged_gap` is NOT confirmed — a knowingly-unpaid month
# stays visible (distinct from needs_review) so it is auditable but no longer
# alarming.
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
    # widen the fetch by the match window so settlements near the edges are seen
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


# A commitment's human-stable slug, pinned in its recurrence notes as `cmt:<slug>`.
# It survives a Bill→recurrence migration (the very event that broke count-based
# matching) because it is NOT the Firefly recurrence id. The slug is the key half
# of the settlement tag.
_CMT_RE = re.compile(r"cmt:([a-z0-9][a-z0-9-]*)", re.IGNORECASE)
# The settlement tag on a real transaction: the month the payment is FOR.
_SETTLES_RE = re.compile(r"^settles:([a-z0-9][a-z0-9-]*):(\d{4})-(\d{2})$")
# A knowingly-accepted unpaid month, pinned in the commitment's notes (a gap has no
# transaction to carry it) — stops a genuine gap re-flagging forever.
_ACKGAP_RE = re.compile(r"ack-gap:([a-z0-9][a-z0-9-]*):(\d{4})-(\d{2})", re.IGNORECASE)


def _slug_of(rec_attr: dict) -> Optional[str]:
    """The bare `cmt:` slug from a recurrence's notes (e.g. `rent`), or None."""
    m = _CMT_RE.search(rec_attr.get("notes") or "")
    return m.group(1).lower() if m else None


def _note_acks(rec_attr: dict) -> set:
    """Months a commitment's notes acknowledge as genuinely unpaid, as
    `{(slug, "YYYY-MM"), ...}`. A gap has no payment transaction to carry the tag,
    so the acknowledgement lives on the commitment itself — written by the valet
    when the user accepts a month was never paid, so it stops re-flagging forever."""
    out: set = set()
    for m in _ACKGAP_RE.finditer(rec_attr.get("notes") or ""):
        out.add((m.group(1).lower(), f"{m.group(2)}-{m.group(3)}"))
    return out


def _settlement_tags(txns: list[dict]) -> tuple[dict, set]:
    """Index the explicit settlement tags across all transactions.

    Returns `(settled, conflicts)`:
      • settled: `{(slug, "YYYY-MM"): txn_id}` — the transaction that settles that
        commitment-month, deterministically the earliest (iterated oldest-first,
        then by id).
      • conflicts: `{(slug, "YYYY-MM"), ...}` — a month claimed by TWO DIFFERENT
        transactions. The write-side valet tool enforces one settler per month, so a
        collision is an upstream/backfill bug — the engine refuses to silently pick a
        winner and surfaces it (`settled_conflict`) rather than clearing the month.

    Acknowledged gaps are NOT read here — a gap has no payment transaction to carry
    the tag, so its acknowledgement lives on the commitment (`_note_acks`), never on
    an arbitrary transaction (which would let a stray tag silently mute an alert)."""
    settled: dict = {}
    first_id: dict = {}
    conflicts: set = set()
    for t in sorted(txns, key=lambda x: (x["date"], str(x.get("id") or ""))):
        tid = t.get("id")
        for raw in t.get("tags") or []:
            m = _SETTLES_RE.match((raw or "").strip().lower())
            if not m:
                continue
            key = (m.group(1), f"{m.group(2)}-{m.group(3)}")
            if key in first_id:
                if first_id[key] != tid:      # a different txn also claims this month
                    conflicts.add(key)
            else:
                first_id[key] = tid
                settled[key] = tid
    return settled, conflicts


def _is_monthly(rec_attr: dict) -> bool:
    """Mechanism A is monthly by definition. A non-monthly non-card recurrence
    cannot be keyed by `YYYY-MM` and is flagged rather than silently mis-keyed."""
    reps = rec_attr.get("repetitions") or []
    types = {r.get("type") for r in reps}
    return bool(types) and types <= {"monthly"}


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
    it, provided `d` also falls after that cycle opened. `None` when the table does
    not reach that far: unknown, never assumed.

    The earliest row has no predecessor to open it, so its opening is taken from the
    spacing to the next row (a month, when it stands alone). Without that bound, the
    first cycle in the table would swallow every older charge and clear them all the
    day its fatura is paid.
    """
    for i, c in enumerate(cycles):
        if c.close < d:
            continue
        if i:
            opens = cycles[i - 1].close
        elif len(cycles) > 1:
            opens = c.close - (cycles[1].close - c.close)
        else:
            opens = c.close - dt.timedelta(days=31)
        return c if d > opens else None
    return None


# ---------- occurrence extraction ----------

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


def _remaining(a: dict, rtype: str, src, dst, cards: dict,
               hist_settle: dict, settled_idx: dict, slug: Optional[str]) -> Optional[int]:
    """Installments still unpaid across the WHOLE finite series (window-independent):
    total N minus occurrences already settled, counted over the full series back to
    first_date — NOT the display window (which may start at `today`). None for
    open-ended recurrences.

    Card series count settled cycles (Mechanism B); non-card series count settled
    period TAGS (Mechanism A) — never a window- or count-based guess."""
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
    elif slug is None:
        paid = 0                       # no slug → nothing can be tag-settled
    else:
        paid = sum(1 for d in full if (slug, _ym(d)) in settled_idx)
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
    cards = fetch_card_accounts()

    # ONE full-history fetch, unconditional — never the display window. A settlement
    # tag's payment date is decoupled from the month it settles (late / advance /
    # lump), so a windowed fetch would miss the settling transaction of an
    # out-of-window payment — the whole bug class. Fetching [earliest first_date,
    # max(today, end)] closes it. Read-only; acceptable cost. This single list feeds
    # BOTH the tag index (Mechanism A) and the settlement list (Mechanism B), so the
    # two never disagree about what exists.
    firsts = [d for d in (_parse_date(r["attributes"].get("first_date")) for r in recs) if d]
    hist_start = min(firsts + [start]) if firsts else start
    txns = fetch_transactions(hist_start, today)

    # Mechanism A: explicit settlement-tag index + double-settle conflicts.
    settled_idx, conflict_idx = _settlement_tags(txns)
    # Mechanism B: one settlement list, built from the full window and shared by the
    # payload and the remaining-count.
    hist_settle = _settlement_dates(txns, cards)

    # A `cmt` slug must identify exactly one commitment. Two recurrences sharing a
    # slug can't be disambiguated by tag alone → flag both, never cross-settle.
    slug_counts: dict = defaultdict(int)
    for r in recs:
        s = _slug_of(r["attributes"])
        if s:
            slug_counts[s] += 1

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
        slug = _slug_of(a)  # the cmt slug pinned in the recurrence notes
        occ_dates = _occurrences(a, start, end)
        if not occ_dates:
            continue
        # Installment position "N/T": T = the finite series length; N = this
        # occurrence's 1-based place in the FULL series (from first_date, NOT the
        # window). Open-ended recurrences carry neither. Regenerating the whole
        # series (bounded by nr_of_repetitions) and indexing it keeps N aligned
        # with the same clamp/skip rules the occurrences themselves use.
        inst_total = a.get("nr_of_repetitions")
        inst_total = int(inst_total) if inst_total is not None else None
        inst_pos: dict = {}
        if inst_total is not None:
            first_d = _parse_date(a.get("first_date"))
            if first_d:
                inst_pos = {d: i + 1
                            for i, d in enumerate(_occurrences(a, first_d, _FAR_HORIZON))}
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
            filled: dict = {}          # occurrence date → the txn that settles it
            acked: set = set()         # occurrence dates acknowledged as unpaid
            occ_flags: dict = defaultdict(list)  # per-occurrence flags

            if is_card:
                # Mechanism B — an occurrence belongs to the cycle it was charged in,
                # and is settled iff that cycle's fatura was paid. The tag path is
                # never consulted here: an installment cannot clear via a tag.
                mechanism = "fatura"
                cycles = cards.get(_norm(src)) or []
                settled = _settled_cycles(cycles, hist_settle.get(_norm(src), []))
                for d in occ_sorted:
                    # No cycle rows, or none covering this date: which fatura the
                    # charge fell into is unknowable, so it is not cleared and it
                    # says so. The flag is per occurrence — a series running past
                    # the end of the table must not cast doubt on its own past.
                    c = _cycle_of(d, cycles) if cycles else None
                    if c is None:
                        occ_flags[d].append("cycle_unknown")
                    elif c.close in settled:
                        filled[d] = settled[c.close]
                        cleared[(_norm(src), c.close)] += amt
            else:
                # Mechanism A — deterministic tag lookup. An occurrence for month M is
                # PAID iff a transaction is tagged `settles:<slug>:M`; otherwise it is
                # acknowledged (ack-gap), needs_review, or upcoming. Nothing inferred.
                assert not is_card, "tag path must never run for a card recurrence"
                mechanism = "tag"
                monthly = _is_monthly(a)
                note_ack = _note_acks(a)
                dup_slug = slug is not None and slug_counts.get(slug, 0) > 1
                for d in occ_sorted:
                    month = _ym(d)
                    if slug is None:
                        # A non-card commitment without a cmt slug cannot be keyed —
                        # a build precondition, surfaced (never guessed, never paid).
                        occ_flags[d].append("missing_slug")
                    elif not monthly:
                        # Mechanism A is monthly by definition; anything else can't be
                        # keyed by YYYY-MM → surfaced, never silently mis-keyed.
                        occ_flags[d].append("non_monthly")
                    elif dup_slug:
                        # Slug shared by >1 commitment → ambiguous → surfaced, never
                        # cross-settled.
                        occ_flags[d].append("duplicate_slug")
                    elif (slug, month) in conflict_idx:
                        # Two transactions claim this month → refuse to pick a winner.
                        occ_flags[d].append("settled_conflict")
                    elif (slug, month) in settled_idx:
                        filled[d] = settled_idx[(slug, month)]
                    elif (slug, month) in note_ack:
                        acked.add(d)

            remaining = _remaining(a, rtype, src, dst, cards,
                                   hist_settle, settled_idx, slug)
            for d in occ_sorted:
                if d in filled:
                    status = _DIR.get(rtype, ("paid",))[0]
                    matched_id = filled[d]
                elif d in acked:
                    status = "acknowledged_gap"
                    matched_id = None
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
                    "installment_no": inst_pos.get(d),
                    "installment_total": inst_total,
                }
                if occ_flags.get(d):
                    item["flags"] = list(occ_flags[d])
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
