"""Forecast engine — occurrence computation + paid status, never guessed:
  • Mechanism A — non-card commitments settled by an explicit `settles:<slug>:<M>` tag.
  • Mechanism B — credit-card installments DERIVED FROM THE BOOKED CHARGES (the single
    source of truth): read the latest parcela of each active plan, project only the
    unbilled tail. Open-ended card charges (subscriptions, no finite N) are still
    recurrences and still clear against a paid billing cycle.
The engine emits the OUTSTANDING set only (confirmed occurrences already live in FF3)."""
from __future__ import annotations

import datetime as dt
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
sys.modules.setdefault("httpx", types.SimpleNamespace(
    Timeout=lambda *a, **k: None, get=None))

import forecast as f  # noqa: E402


def _rec(title, rtype, moment, amount, src, dst, first, nr=None, notes=None, cur="BRL",
         rep_type="monthly"):
    return {"attributes": {
        "active": False, "type": rtype, "title": title, "notes": notes,
        "first_date": first, "repeat_until": None, "nr_of_repetitions": nr,
        "repetitions": [{"type": rep_type, "moment": str(moment), "skip": 0}],
        "transactions": [{"amount": str(amount), "currency_code": cur,
                          "source_name": src, "destination_name": dst,
                          "category_name": None}]}}


def _txn(tid, date, dst, tags=(), src="bank", amount=1000.0,
         rtype="withdrawal", cur="BRL"):
    """A real Mechanism-A payment. `tags` carries the explicit period tag(s)
    `settles:<slug>:<YYYY-MM>` that attribute it to the month(s) it is FOR."""
    return {"id": tid, "type": rtype, "date": dt.date.fromisoformat(date),
            "amount": amount, "currency": cur, "source": src,
            "destination": dst, "description": "x", "tags": list(tags)}


def _cycles(*pairs):
    """(close, due) date strings → the cycle list a card's notes would parse to."""
    return [f.Cycle(dt.date.fromisoformat(c), dt.date.fromisoformat(d)) for c, d in pairs]


def _monthly_cycles(year, months, close_day, due_day):
    return _cycles(*[(f"{year}-{m:02d}-{close_day:02d}", f"{year}-{m:02d}-{due_day:02d}")
                     for m in months])


def _wire(monkeypatch, recs, txns, cards=None):
    """`cards` maps a card account name to its cycle list ([] = cycles unknown)."""
    monkeypatch.setattr(f, "fetch_recurrences", lambda: recs)
    monkeypatch.setattr(f, "fetch_transactions", lambda s, e: txns)
    monkeypatch.setattr(f, "fetch_card_accounts",
                        lambda: {f._norm(k): v for k, v in (cards or {}).items()})


def _settlement(txn_id, date, card, desc="Pagamento fatura", src="Itau"):
    return {"id": txn_id, "type": "transfer", "date": dt.date.fromisoformat(date),
            "amount": 100.0, "currency": "BRL", "source": src,
            "destination": card, "description": desc, "tags": []}


def _sub(title, moment, amount, card, first, cur="BRL"):
    """An OPEN-ENDED card subscription (no nr_of_repetitions): a monthly charge on a
    card that clears against its paid billing cycle (Mechanism B). Unlike a finite
    installment — which is now derived from the booked charges, not a recurrence."""
    return _rec(title, "withdrawal", moment, amount, card, "", first, cur=cur)


def _charge(date, n, m, amount=300.0, card="Itaucard", desc=None, tags=(),
            cur="BRL", cat=None, tid=None):
    """A REAL booked installment charge on a card — the source of truth the derived
    forecast reads. Carries `installment N/M` in its description (the issuer's own
    text) unless a `tags`/`desc` override is given."""
    body = desc if desc is not None else f"STORE (installment {n}/{m})"
    return {"id": tid or f"c{n}-{int(amount)}", "type": "withdrawal",
            "date": dt.date.fromisoformat(date), "amount": amount, "currency": cur,
            "source": card, "destination": "Store", "category": cat,
            "description": body, "tags": list(tags)}


def _outstanding(res):
    return {it["date"]: it for per in res["periods"] for it in per["items"]}


def test_nr_of_repetitions_bounds_series():
    occ = f._occurrences(
        {"first_date": "2026-02-09", "repeat_until": None, "nr_of_repetitions": 3,
         "repetitions": [{"type": "monthly", "moment": "9", "skip": 0}]},
        dt.date(2026, 1, 1), dt.date(2026, 12, 31))
    assert [d.isoformat() for d in occ] == ["2026-02-09", "2026-03-09", "2026-04-09"]


def test_nr_counts_from_first_not_window():
    occ = f._occurrences(
        {"first_date": "2026-02-09", "repeat_until": None, "nr_of_repetitions": 3,
         "repetitions": [{"type": "monthly", "moment": "9", "skip": 0}]},
        dt.date(2026, 4, 1), dt.date(2026, 12, 31))
    assert [d.isoformat() for d in occ] == ["2026-04-09"]


def _wire_ranged(monkeypatch, recs, txns, cards=None):
    """Like `_wire`, but `fetch_transactions` HONORS its [start, end] arguments —
    so a test can prove the engine fetches full history (not the display window):
    an out-of-display-window settling txn is only seen if the engine widened the
    fetch to the series' first_date."""
    monkeypatch.setattr(f, "fetch_recurrences", lambda: recs)
    monkeypatch.setattr(f, "fetch_transactions",
                        lambda s, e: [t for t in txns if s <= t["date"] <= e])
    monkeypatch.setattr(f, "fetch_card_accounts",
                        lambda: {f._norm(k): v for k, v in (cards or {}).items()})


# ---------- Mechanism A: deterministic settlement by explicit period tag ----------

def test_tag_settles_exactly_its_month(monkeypatch):
    """Use case 1 (on-time). A `settles:rent:2026-06` tag clears June — dropped
    from the outstanding set, and attributed to the real txn. Untagged neighbours
    stay open; no count, no window heuristic."""
    today = dt.date(2026, 7, 12)
    recs = [_rec("Rent", "withdrawal", 5, 1000, "Bank", "Landlord",
                 "2026-05-05", notes="cmt:rent")]
    txns = [_txn("t1", "2026-06-07", "Landlord", tags=["settles:rent:2026-06"])]
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 5, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert "2026-06-05" not in out                          # tagged → paid → dropped
    assert out["2026-05-05"]["status"] == "needs_review"    # untagged, past
    assert out["2026-07-05"]["status"] == "needs_review"
    assert out["2026-08-05"]["status"] == "upcoming"
    assert out["2026-05-05"]["mechanism"] == "tag"


def test_paid_occurrence_carries_the_settling_txn_id(monkeypatch):
    """A settled month is dropped from the payload, but a partly-settled series still
    shows the neighbour; the paid one's attribution is recoverable via the tag index."""
    today = dt.date(2026, 7, 12)
    recs = [_rec("Rent", "withdrawal", 5, 1000, "Bank", "Landlord",
                 "2026-06-05", notes="cmt:rent")]
    txns = [_txn("txn-1", "2026-06-07", "Landlord",
                 tags=["settles:rent:2026-06"])]
    _wire(monkeypatch, recs, txns)
    settled, _ = f._settlement_tags(txns)
    assert settled[("rent", "2026-06")] == "txn-1"    # attributable, auditable


def test_late_payment_tag_credits_the_intended_month(monkeypatch):
    """Use case 2 (late). Paid 2026-07-20 but tagged for June → June paid, July still
    open. The payment date is irrelevant; the tag is the truth."""
    today = dt.date(2026, 7, 25)
    recs = [_rec("Rent", "withdrawal", 15, 1000, "Bank", "Landlord",
                 "2026-06-15", notes="cmt:rent")]
    txns = [_txn("late", "2026-07-20", "Landlord", tags=["settles:rent:2026-06"])]
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert "2026-06-15" not in out                          # late payment, June paid
    assert out["2026-07-15"]["status"] == "needs_review"    # not falsely paid


def test_advance_payment_tag_credits_the_future_month(monkeypatch):
    """Use case 3 (advance). Paid 2026-06-20 but tagged for July → July paid in
    advance, June untouched."""
    today = dt.date(2026, 7, 25)
    recs = [_rec("Rent", "withdrawal", 15, 1000, "Bank", "Landlord",
                 "2026-06-15", notes="cmt:rent")]
    txns = [_txn("adv", "2026-06-20", "Landlord", tags=["settles:rent:2026-07"])]
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert "2026-07-15" not in out                          # advance → July paid
    assert out["2026-06-15"]["status"] == "needs_review"


def test_lump_payment_settles_every_tagged_month(monkeypatch):
    """Use case 9 (lump). One txn carrying three `settles:` tags clears three months,
    each attributed to that same txn."""
    today = dt.date(2026, 7, 25)
    recs = [_rec("Pension", "transfer", 10, 500, "Bank", "XP",
                 "2026-05-10", notes="cmt:pension")]
    txns = [_txn("lump", "2026-05-10", "XP", src="bank", rtype="transfer",
                 tags=["settles:pension:2026-05", "settles:pension:2026-06",
                       "settles:pension:2026-07"])]
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 5, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert set(out) == {"2026-08-10"}                       # only the untagged month
    settled, _ = f._settlement_tags(txns)
    assert settled[("pension", "2026-06")] == "lump"


def test_variable_amount_is_settlement_blind(monkeypatch):
    """Use case 4. A tag settles regardless of amount — the amount check is a
    WRITE-side concern (the valet tool), never a read-side gate here."""
    today = dt.date(2026, 7, 25)
    recs = [_rec("Power", "withdrawal", 8, 300, "Bank", "PowerCo",
                 "2026-06-08", notes="cmt:power")]
    txns = [_txn("v", "2026-06-08", "PowerCo", amount=812.55,
                 tags=["settles:power:2026-06"])]
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 6, 30), today=today)
    assert "2026-06-08" not in _outstanding(res)            # settled despite amount


def test_migrated_recurrence_old_payments_never_poison(monkeypatch):
    """Use case 5 — the live bug. A recurrence whose first_date is a recent migration
    date has real payee history predating it. Those old payments are not occurrences,
    are never scanned, and cannot poison the verdict. Only the tagged month clears."""
    today = dt.date(2026, 7, 12)
    recs = [_rec("Rent", "withdrawal", 10, 5900, "Bank", "Landlord",
                 "2026-06-10", notes="cmt:rent")]
    # six untagged pre-migration payments + one tagged June payment
    txns = [_txn(f"old{m}", f"2026-{m:02d}-07", "Landlord") for m in range(1, 7)]
    txns.append(_txn("jun", "2026-06-07", "Landlord",
                     tags=["settles:rent:2026-06"]))
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 7, 31), today=today)
    out = _outstanding(res)
    assert "2026-06-10" not in out                          # June tagged → paid
    assert out["2026-07-10"]["status"] == "needs_review"    # untagged, past
    assert not any("noisy" in fl for it in out.values() for fl in it.get("flags", []))


def test_ad_hoc_noise_cannot_fabricate_a_clear(monkeypatch):
    """Use case 6. Many small untagged Pix to a payee that also holds a monthly
    commitment. Without a tag, nothing clears — the noise is simply ignored."""
    today = dt.date(2026, 8, 1)
    recs = [_rec("Housekeeper", "withdrawal", 5, 1100, "Bank", "Maria",
                 "2026-06-05", notes="cmt:cleaning")]
    txns = [_txn(f"pix{i}", f"2026-06-{5 + i:02d}", "Maria", amount=50.0)
            for i in range(5)]                               # untagged noise
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert out["2026-06-05"]["status"] == "needs_review"    # not silently paid
    assert out["2026-07-05"]["status"] == "needs_review"


def test_genuine_gap_names_the_exact_month(monkeypatch):
    """Use case 7. A never-paid month is needs_review on THAT month — not the latest,
    not a count. Every other month with a tag clears."""
    today = dt.date(2026, 7, 25)
    recs = [_rec("Rent", "withdrawal", 5, 1000, "Bank", "Landlord",
                 "2026-05-05", notes="cmt:rent")]
    txns = [_txn("may", "2026-05-06", "Landlord", tags=["settles:rent:2026-05"]),
            _txn("jul", "2026-07-06", "Landlord", tags=["settles:rent:2026-07"])]
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 5, 1),
                             end=dt.date(2026, 7, 31), today=today)
    out = _outstanding(res)
    assert set(out) == {"2026-06-05"}                       # exactly the gap month
    assert out["2026-06-05"]["status"] == "needs_review"


def test_acknowledged_gap_stops_reflagging(monkeypatch):
    """Use case 7 (accepted). A gap the user accepted carries `ack-gap:slug:M` in the
    commitment notes → status `acknowledged_gap`, distinct from needs_review, and no
    longer alarming. It is not confirmed, so it stays visible/auditable."""
    today = dt.date(2026, 7, 25)
    recs = [_rec("Rent", "withdrawal", 5, 1000, "Bank", "Landlord", "2026-05-05",
                 notes="cmt:rent\nack-gap:rent:2026-06")]
    txns = [_txn("may", "2026-05-06", "Landlord", tags=["settles:rent:2026-05"]),
            _txn("jul", "2026-07-06", "Landlord", tags=["settles:rent:2026-07"])]
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 5, 1),
                             end=dt.date(2026, 7, 31), today=today)
    out = _outstanding(res)
    assert out["2026-06-05"]["status"] == "acknowledged_gap"
    assert "flags" not in out["2026-06-05"]                 # not an error state


def test_two_commitments_one_payee_kept_distinct(monkeypatch):
    """Use case 8. Two commitments to the same payee carry different slugs → different
    tags → never confused."""
    today = dt.date(2026, 7, 25)
    recs = [_rec("Rent", "withdrawal", 5, 1000, "Bank", "Landlord",
                 "2026-06-05", notes="cmt:rent"),
            _rec("Garage", "withdrawal", 5, 200, "Bank", "Landlord",
                 "2026-06-05", notes="cmt:garagem")]
    txns = [_txn("rent", "2026-06-06", "Landlord", tags=["settles:rent:2026-06"])]
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 6, 30), today=today)
    out = _outstanding(res)
    titles = {it["title"] for it in out.values()}
    assert titles == {"Garage"}                             # rent paid, garage open


def test_future_occurrence_is_upcoming_never_auto_settled(monkeypatch):
    """Use case 14. An occurrence dated on/after today with no tag is `upcoming`,
    never paid, never needs_review — the split is a calendar fact."""
    today = dt.date(2026, 7, 12)
    recs = [_rec("iCloud", "withdrawal", 24, 15, "Bank", "Apple",
                 "2026-06-24", notes="cmt:icloud")]
    txns = []
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert out["2026-06-24"]["status"] == "needs_review"    # past, untagged
    assert out["2026-07-24"]["status"] == "upcoming"        # >= today
    assert out["2026-08-24"]["status"] == "upcoming"


def test_missing_slug_is_surfaced_never_paid(monkeypatch):
    """A non-card commitment with no `cmt:` slug cannot be keyed. It is flagged
    `missing_slug` and left open — a build precondition, surfaced, never guessed."""
    today = dt.date(2026, 7, 25)
    recs = [_rec("Rent", "withdrawal", 5, 1000, "Bank", "Landlord", "2026-06-05")]
    txns = [_txn("t", "2026-06-06", "Landlord", tags=["settles:rent:2026-06"])]
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 6, 30), today=today)
    out = _outstanding(res)
    assert out["2026-06-05"]["flags"] == ["missing_slug"]
    assert out["2026-06-05"]["status"] == "needs_review"


def test_non_monthly_non_card_is_surfaced_never_paid(monkeypatch):
    """A weekly (non-monthly) non-card recurrence can't be keyed by YYYY-MM → flagged
    `non_monthly`, never silently mis-keyed."""
    today = dt.date(2026, 7, 25)
    recs = [_rec("Odd", "withdrawal", 1, 100, "Bank", "Someone", "2026-07-06",
                 notes="cmt:odd", rep_type="weekly")]
    _wire(monkeypatch, recs, [])
    res = f.build_projection(granularity="month", start=dt.date(2026, 7, 1),
                             end=dt.date(2026, 7, 20), today=today)
    out = _outstanding(res)
    assert out and all(it["flags"] == ["non_monthly"] for it in out.values())


def test_full_history_fetch_sees_out_of_window_settler(monkeypatch):
    """The root fix. July's occurrence is settled by a txn dated in JANUARY (an
    advance, tagged for July). The display window is July only. The engine must fetch
    full history (back to first_date), not the display window, or it misses the
    settling txn and falsely flags July. `_wire_ranged` honours the fetch bounds, so
    this only passes if the engine widened the fetch."""
    today = dt.date(2026, 7, 25)
    recs = [_rec("Rent", "withdrawal", 15, 1000, "Bank", "Landlord",
                 "2026-01-15", notes="cmt:rent")]
    txns = [_txn("adv", "2026-01-20", "Landlord", tags=["settles:rent:2026-07"])]
    _wire_ranged(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 7, 1),
                             end=dt.date(2026, 7, 31), today=today)
    assert "2026-07-15" not in _outstanding(res)            # January txn was found


def test_verdict_is_window_independent(monkeypatch):
    """A shared occurrence's verdict is identical in a narrow and a wide DISPLAY
    window — the whole point. Run both, diff the overlap → ∅."""
    today = dt.date(2026, 7, 25)
    recs = [_rec("Rent", "withdrawal", 15, 1000, "Bank", "Landlord",
                 "2026-01-15", notes="cmt:rent")]
    txns = [_txn("jun", "2026-06-16", "Landlord", tags=["settles:rent:2026-06"])]
    _wire_ranged(monkeypatch, recs, txns)
    narrow = _outstanding(f.build_projection(
        granularity="month", start=dt.date(2026, 6, 1),
        end=dt.date(2026, 7, 31), today=today))
    wide = _outstanding(f.build_projection(
        granularity="month", start=dt.date(2023, 1, 1),
        end=dt.date(2026, 12, 31), today=today))
    shared = set(narrow) & set(wide)
    assert "2026-06-15" not in shared                       # paid in both → dropped
    assert shared                                           # e.g. 2026-07-15
    for k in shared:
        assert narrow[k]["status"] == wide[k]["status"]     # diff == ∅


def test_double_settle_is_flagged_not_silently_cleared(monkeypatch):
    """Use case 11 (overpayment / duplicate). Two DIFFERENT transactions both tag the
    same month → the engine refuses to pick a winner: `settled_conflict`, left open,
    surfaced. It never silently clears one and drops the month."""
    today = dt.date(2026, 7, 25)
    recs = [_rec("Rent", "withdrawal", 5, 1000, "Bank", "Landlord",
                 "2026-06-05", notes="cmt:rent")]
    txns = [_txn("a", "2026-06-06", "Landlord", tags=["settles:rent:2026-06"]),
            _txn("b", "2026-06-20", "Landlord", tags=["settles:rent:2026-06"])]
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 6, 30), today=today)
    out = _outstanding(res)
    assert out["2026-06-05"]["flags"] == ["settled_conflict"]
    assert out["2026-06-05"]["status"] == "needs_review"    # not dropped


def test_same_txn_repeated_tag_is_idempotent_not_a_conflict(monkeypatch):
    """One transaction carrying the same tag twice is dedupe, not a double-settle."""
    today = dt.date(2026, 7, 25)
    recs = [_rec("Rent", "withdrawal", 5, 1000, "Bank", "Landlord",
                 "2026-06-05", notes="cmt:rent")]
    txns = [_txn("a", "2026-06-06", "Landlord",
                 tags=["settles:rent:2026-06", "settles:rent:2026-06"])]
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 6, 30), today=today)
    assert "2026-06-05" not in _outstanding(res)            # settled, no conflict


def test_duplicate_slug_across_commitments_is_flagged(monkeypatch):
    """A `cmt` slug shared by two commitments is ambiguous — a payment for one would
    otherwise cross-settle the other. Both are flagged `duplicate_slug`, never
    cleared, even when a matching tag exists."""
    today = dt.date(2026, 7, 25)
    recs = [_rec("Rent", "withdrawal", 5, 1000, "Bank", "Landlord",
                 "2026-06-05", notes="cmt:dup"),
            _rec("Power", "withdrawal", 8, 300, "Bank", "PowerCo",
                 "2026-06-08", notes="cmt:dup")]
    txns = [_txn("t", "2026-06-06", "Landlord", tags=["settles:dup:2026-06"])]
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 6, 30), today=today)
    out = _outstanding(res)
    assert out["2026-06-05"]["flags"] == ["duplicate_slug"]
    assert out["2026-06-08"]["flags"] == ["duplicate_slug"]
    assert out["2026-06-05"]["status"] == "needs_review"    # not cross-settled


def test_remaining_counts_tagged_months_for_finite_non_card_series(monkeypatch):
    """`_remaining` on a finite NON-card series is tag-derived: N minus tagged months,
    window-independent — not a count- or ordered-fill guess."""
    today = dt.date(2026, 8, 1)
    recs = [_rec("Plan", "withdrawal", 10, 200, "Bank", "Gym",
                 "2026-05-10", nr=3, notes="cmt:gym")]
    txns = [_txn("m", "2026-05-10", "Gym", tags=["settles:gym:2026-05"]),
            _txn("j", "2026-06-10", "Gym", tags=["settles:gym:2026-06"])]
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 5, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert set(out) == {"2026-07-10"}                       # only the untagged month
    assert out["2026-07-10"]["remaining"] == 1              # 3 − 2 tagged


# ---------- Mechanism B (a): open-ended card subscriptions clear against a cycle ----------
# A subscription is a card charge with NO finite N: still a recurrence, still settled
# by its paid billing cycle. The cycle machinery below serves these (finite
# installments are covered separately, derived from the booked charges).

def test_open_card_sub_ignores_a_stray_settles_tag(monkeypatch):
    """Mechanism-B isolation, by construction: a `settles:` tag on a card charge is
    never consulted — the tag path does not run for a card recurrence. Only the cycle
    settles it."""
    today = dt.date(2026, 7, 21)
    recs = [_sub("Netflix", 15, 300, "Itaucard", "2026-06-15")]
    # a stray tag that WOULD clear June if the tag path (wrongly) ran for a card
    txns = [{"id": "stray", "type": "withdrawal", "date": dt.date(2026, 6, 15),
             "amount": 300.0, "currency": "BRL", "source": "Itaucard",
             "destination": "Store", "description": "x",
             "tags": ["settles:netflix:2026-06"]}]
    cycles = _cycles(("2026-07-02", "2026-07-09"), ("2026-08-02", "2026-08-09"))
    _wire(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert out["2026-06-15"]["mechanism"] == "fatura"       # B, not tag
    assert out["2026-06-15"]["status"] == "needs_review"    # tag ignored, cycle unpaid


def test_card_verdict_holds_under_bound_honoring_fetch(monkeypatch):
    """Mechanism-B regression guard: the widened full-history fetch (ceilinged at
    `today`, not the display `end`) must not corrupt the card path. The display window
    ENDS 30/06 but the June-charge's fatura is paid late on 20/07 — the engine must
    fetch past `end` to `today` and clear it. Uses the bound-honoring stub."""
    today = dt.date(2026, 7, 25)
    recs = [_sub("Netflix", 15, 300, "Itaucard", "2026-06-15")]
    cycles = _cycles(("2026-07-02", "2026-07-09"), ("2026-08-02", "2026-08-09"))
    txns = [_settlement("late", "2026-07-20", "Itaucard")]
    _wire_ranged(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 6, 30), today=today)
    assert "2026-06-15" not in _outstanding(res)            # cleared via late fatura


def test_fatura_clears_the_cycle_a_charge_fell_in(monkeypatch):
    """A charge on the 9th belongs to the fatura closing on the 12th, paid on the
    20th. Feb–Apr paid → dropped; May open. (Open-ended sub; window bounds the tail.)"""
    today = dt.date(2026, 7, 12)
    recs = [_sub("Spotify", 9, 300, "Itaucard", "2026-02-09")]
    txns = [_settlement(f"s{m}", f"2026-{m:02d}-20", "Itaucard") for m in (2, 3, 4)]
    cycles = _monthly_cycles(2026, range(1, 13), 12, 20)
    _wire(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 2, 1),
                             end=dt.date(2026, 5, 31), today=today)
    out = _outstanding(res)
    assert set(out) == {"2026-05-09"}
    assert out["2026-05-09"]["status"] == "needs_review"
    assert out["2026-05-09"]["mechanism"] == "fatura"


def test_late_payment_clears_the_cycle_it_belongs_to(monkeypatch):
    """The live regression: a fatura closing 02/07 (charges from 03/06) paid 11 days
    late on 20/07 clears the JUNE-dated charge — not the July one, which belongs to
    the cycle closing 02/08 and is not yet paid."""
    today = dt.date(2026, 7, 21)
    recs = [_sub("Spotify", 15, 300, "Itaucard", "2026-06-15")]
    cycles = _cycles(("2026-06-02", "2026-06-09"), ("2026-07-02", "2026-07-09"),
                     ("2026-08-02", "2026-08-09"), ("2026-09-02", "2026-09-09"))
    txns = [_settlement("jul", "2026-07-20", "Itaucard")]
    _wire(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert "2026-06-15" not in out          # cycle closing 02/07, paid late → cleared
    assert out["2026-07-15"]["status"] == "needs_review"   # cycle closing 02/08, unpaid


def test_minimum_alongside_full_payment_clears_one_cycle(monkeypatch):
    """A minimum paid on the 17th and the full fatura on the 20th are two settlements
    but one cycle: the next has not closed, so the surplus clears nothing."""
    today = dt.date(2026, 7, 21)
    recs = [_sub("Spotify", 15, 300, "Itaucard", "2026-06-15")]
    cycles = _cycles(("2026-06-02", "2026-06-09"), ("2026-07-02", "2026-07-09"),
                     ("2026-08-02", "2026-08-09"))
    txns = [_settlement("min", "2026-07-17", "Itaucard", desc="Pagamento mínimo"),
            _settlement("full", "2026-07-20", "Itaucard")]
    _wire(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert "2026-06-15" not in out
    assert out["2026-07-15"]["status"] == "needs_review"   # August cycle still unpaid


def test_skipped_cycle_is_not_cleared_by_a_later_payment(monkeypatch):
    """June's fatura was never paid; July's was paid on time. June must stay open —
    an on-time payment cannot silently absorb the cycle before it."""
    today = dt.date(2026, 7, 21)
    recs = [_sub("Spotify", 15, 300, "Itaucard", "2026-05-15")]
    cycles = _cycles(("2026-06-02", "2026-06-09"), ("2026-07-02", "2026-07-09"),
                     ("2026-08-02", "2026-08-09"))
    txns = [_settlement("jul", "2026-07-09", "Itaucard")]
    _wire(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 5, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert out["2026-05-15"]["status"] == "needs_review"   # cycle closing 02/06, unpaid
    assert "2026-06-15" not in out                        # cycle closing 02/07, paid


def test_no_cycle_rows_clears_nothing_and_flags(monkeypatch):
    """Cycles unknown → the engine refuses to attribute, and says so."""
    today = dt.date(2026, 7, 21)
    recs = [_sub("Spotify", 15, 300, "Itaucard", "2026-06-15")]
    txns = [_settlement("jul", "2026-07-20", "Itaucard")]
    _wire(monkeypatch, recs, txns, cards={"Itaucard": []})
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert out["2026-06-15"]["flags"] == ["cycle_unknown"]
    assert out["2026-06-15"]["status"] == "needs_review"
    assert res["meta"]["cards"][0]["cycles_known"] is False


def test_charge_beyond_the_cycle_table_is_never_assumed(monkeypatch):
    """A charge later than the last known closing date has no cycle → not cleared."""
    today = dt.date(2026, 9, 30)
    recs = [_sub("Spotify", 15, 300, "Itaucard", "2026-06-15")]
    cycles = _cycles(("2026-06-02", "2026-06-09"), ("2026-07-02", "2026-07-09"))
    txns = [_settlement("jun", "2026-06-09", "Itaucard"),
            _settlement("jul", "2026-07-09", "Itaucard")]
    _wire(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 9, 30), today=today)
    out = _outstanding(res)
    assert "2026-08-15" in out and "2026-09-15" in out
    assert out["2026-08-15"]["flags"] == ["cycle_unknown"]


def test_reversal_is_not_a_settlement(monkeypatch):
    today = dt.date(2026, 7, 21)
    recs = [_sub("Spotify", 15, 300, "Itaucard", "2026-06-15")]
    cycles = _cycles(("2026-07-02", "2026-07-09"), ("2026-08-02", "2026-08-09"))
    txns = [_settlement("e", "2026-07-20", "Itaucard", desc="Estorno pagamento fatura")]
    _wire(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 8, 31), today=today)
    assert _outstanding(res)["2026-06-15"]["status"] == "needs_review"


def test_cycle_summary_reconciles_against_the_fatura_total(monkeypatch):
    """The fatura says what it totalled; the engine reports what it cleared against it,
    so an over- or under-clear is visible even though confirmed items are dropped."""
    today = dt.date(2026, 7, 21)
    recs = [_sub("Spotify", 15, 300, "Itaucard", "2026-06-15")]
    cycles = [f.Cycle(dt.date(2026, 7, 2), dt.date(2026, 7, 9), 1000.0)]
    txns = [_settlement("jul", "2026-07-20", "Itaucard")]
    _wire(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 6, 30), today=today)
    row = res["meta"]["cards"][0]["cycles"][0]
    assert row["settled_by"] == "jul"
    assert row["recurring_cleared"] == 300.0
    assert row["unreconciled"] == 700.0


def test_parse_cycles_reads_notes_and_ignores_rubbish():
    cycles = f.parse_cycles(
        "XP Visa\n"
        "cycle: close=2026-07-13 due=2026-07-20 total=26139.84\n"
        "cycle: close=2026-06-10 due=2026-06-20\n"
        "cycle: close=2026-05-40 due=2026-05-20\n"      # not a date → ignored
        "cycle: close=2026-04-10 due=2026-03-20\n"      # due before close → ignored
        "some other note\n")
    assert [c.close.isoformat() for c in cycles] == ["2026-06-10", "2026-07-13"]
    assert cycles[1].total == 26139.84 and cycles[0].total is None


def test_non_fatura_transfer_does_not_clear(monkeypatch):
    """A transfer that is NOT into the card must not clear a charge's cycle."""
    today = dt.date(2026, 7, 12)
    recs = [_sub("Spotify", 9, 300, "Itaucard", "2026-06-09")]
    txns = [{"id": "x", "type": "transfer", "date": dt.date(2026, 6, 8),
             "amount": 9.0, "currency": "BRL", "source": "Itaucard",
             "destination": "Savings", "description": "not a fatura", "tags": []}]
    _wire(monkeypatch, recs, txns,
          cards={"Itaucard": _monthly_cycles(2026, range(1, 13), 2, 9)})
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 6, 30), today=today)
    out = _outstanding(res)
    assert out["2026-06-09"]["status"] == "needs_review"   # still open


def test_first_cycle_does_not_swallow_older_charges(monkeypatch):
    """The earliest row opens where the spacing to the next says it does. A charge
    from before that is not in it, and paying that fatura must not clear it."""
    today = dt.date(2026, 7, 21)
    recs = [_sub("Spotify", 9, 300, "Itaucard", "2026-04-09")]
    cycles = _cycles(("2026-06-02", "2026-06-09"), ("2026-07-02", "2026-07-09"))
    txns = [_settlement("jun", "2026-06-09", "Itaucard")]
    _wire(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 4, 1),
                             end=dt.date(2026, 7, 31), today=today)
    out = _outstanding(res)
    assert out["2026-04-09"]["flags"] == ["cycle_unknown"]   # older than the table
    assert "2026-05-09" not in out                           # opens 03/05 → June cycle
    assert out["2026-06-09"]["status"] == "needs_review"     # July cycle, unpaid


def test_cycle_unknown_is_per_occurrence_not_per_series(monkeypatch):
    """A series running past the end of the table must not cast doubt on the months
    the table does cover."""
    today = dt.date(2026, 9, 30)
    recs = [_sub("Spotify", 20, 300, "Itaucard", "2026-06-20")]
    cycles = _cycles(("2026-06-02", "2026-06-09"), ("2026-07-02", "2026-07-09"))
    txns = []
    _wire(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 9, 30), today=today)
    out = _outstanding(res)
    assert out["2026-06-20"].get("flags") is None            # covered by the table
    assert out["2026-08-20"]["flags"] == ["cycle_unknown"]   # beyond it


# ---------- Mechanism B (b): finite installments DERIVED FROM THE BOOKED CHARGES ----------
# The single source of truth. Read the latest parcela of each active plan off the last
# closed statement (plus brand-new plans off the open one); project only the UNBILLED
# tail N+1..M. A charge already in the ledger is never also projected, so the current
# month can never be double-counted — the bug this whole mechanism exists to kill.

def _cyc4():
    """Itaú-style monthly cycles closing on the 2nd, Jun–Sep 2026, due on the 9th."""
    return _cycles(("2026-06-02", "2026-06-09"), ("2026-07-02", "2026-07-09"),
                   ("2026-08-02", "2026-08-09"), ("2026-09-02", "2026-09-09"))


def test_derived_installment_projects_only_the_unbilled_tail(monkeypatch):
    """A `10/12` booked in the last closed statement projects 11 and 12 only — never
    10 (already in the ledger). This is the fix for the current-month double-count."""
    today = dt.date(2026, 7, 21)
    charges = [_charge("2026-07-02", 10, 12, amount=299.87)]
    _wire(monkeypatch, [], charges, cards={"Itaucard": _cyc4()})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    out = _outstanding(res)
    assert set(out) == {"2026-08-02", "2026-09-02"}          # 11/12, 12/12 — not 10
    assert out["2026-08-02"]["installment_no"] == 11
    assert out["2026-08-02"]["installment_total"] == 12
    assert out["2026-09-02"]["installment_no"] == 12
    assert out["2026-08-02"]["remaining"] == 2
    assert out["2026-08-02"]["mechanism"] == "fatura"
    assert out["2026-08-02"]["status"] == "upcoming"


def test_completed_plan_projects_nothing(monkeypatch):
    """The last parcela (12/12) is already billed → the plan is done → no forecast."""
    today = dt.date(2026, 7, 21)
    charges = [_charge("2026-07-02", 12, 12, amount=406.74)]
    _wire(monkeypatch, [], charges, cards={"Itaucard": _cyc4()})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    assert _outstanding(res) == {}


def test_installment_total_comes_from_the_tag_when_present(monkeypatch):
    """The `installment:<total>:<current>` tag wins over the description text."""
    today = dt.date(2026, 7, 21)
    charges = [_charge("2026-07-02", 0, 0, amount=299.87, desc="DELL COMPUTER",
                       tags=["installment:12:10"])]
    _wire(monkeypatch, [], charges, cards={"Itaucard": _cyc4()})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    out = _outstanding(res)
    assert set(out) == {"2026-08-02", "2026-09-02"}
    assert out["2026-08-02"]["installment_no"] == 11
    assert out["2026-08-02"]["installment_total"] == 12
    assert out["2026-08-02"]["title"] == "DELL COMPUTER"


def test_three_identical_plans_stay_distinct(monkeypatch):
    """Three identical `8/12` charges are three plans, not one — multiplicity is
    preserved (the description can't tell them apart, so we never collapse them)."""
    today = dt.date(2026, 7, 21)
    charges = [_charge("2026-07-02", 8, 12, amount=368.90, tid=f"m{i}") for i in range(3)]
    _wire(monkeypatch, [], charges, cards={"Itaucard": _cyc4()})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    items = [it for per in res["periods"] for it in per["items"]]
    # each plan projects 9,10,11,12 → 3 plans × 4 = 12 rows; two per projected month
    assert len(items) == 12
    aug = [it for it in items if it["date"] == "2026-08-02"]
    assert len(aug) == 3 and all(it["installment_no"] == 9 for it in aug)


def test_brand_new_plan_billed_into_the_last_statement_is_projected(monkeypatch):
    """A `1/12` whose first charge is on the last CLOSED statement projects 2..12 — a
    new plan is caught as soon as it appears on a statement."""
    today = dt.date(2026, 7, 21)
    charges = [_charge("2026-07-02", 1, 12, amount=200.0)]     # on the last close (02/07)
    _wire(monkeypatch, [], charges, cards={"Itaucard": _cyc4()})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    out = _outstanding(res)
    assert out["2026-08-02"]["installment_no"] == 2
    assert out["2026-08-02"]["installment_total"] == 12
    assert out["2026-08-02"]["remaining"] == 11


def test_open_cycle_purchase_is_deferred_one_statement(monkeypatch):
    """A plan purchased in the still-open cycle (after the last close) is NOT yet
    projected — the engine forecasts from statements, and this one hasn't closed. Honest
    ≤1-cycle lag, never a fabricated plan."""
    today = dt.date(2026, 7, 21)
    charges = [_charge("2026-07-10", 1, 12, amount=200.0)]     # after last close (02/07)
    _wire(monkeypatch, [], charges, cards={"Itaucard": _cyc4()})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    assert _outstanding(res) == {}


def test_consecutive_parcelas_take_the_latest_never_double_count(monkeypatch):
    """The same plan across two CLOSED statements (N, then N+1) projects only from its
    latest parcela — the earlier statement is never read, so the booked N+1 is never
    also projected. Holds even when the parcela AMOUNT differs (interest / last-parcela
    rounding), because nothing is matched by amount."""
    today = dt.date(2026, 8, 5)
    charges = [_charge("2026-07-02", 8, 12, amount=300.00, tid="a"),   # prior statement
               _charge("2026-08-02", 9, 12, amount=290.00, tid="b")]   # last statement
    _wire(monkeypatch, [], charges, cards={"Itaucard": _cyc4()})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    nos = sorted(it["installment_no"] for per in res["periods"] for it in per["items"])
    assert nos == [10, 11, 12]                                # from 9, once — never 9 again


def test_varying_amount_completed_plan_projects_nothing(monkeypatch):
    """A sem-juros plan whose final parcela carries the rounding remainder (a cent more)
    is still recognised complete once that parcela is booked — no amount match involved,
    so the earlier parcela can't resurrect the tail."""
    today = dt.date(2026, 8, 5)
    charges = [_charge("2026-07-02", 2, 3, amount=333.33, tid="a"),    # prior statement
               _charge("2026-08-02", 3, 3, amount=333.34, tid="b")]    # last statement, N=M
    _wire(monkeypatch, [], charges, cards={"Itaucard": _cyc4()})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    assert _outstanding(res) == {}                            # plan done — nothing


def test_two_distinct_equal_amount_plans_on_one_statement_both_survive(monkeypatch):
    """Two DIFFERENT purchases of the same value, at parcelas N and N+1, billed on the
    SAME statement are two plans — both tails are projected. They are never collapsed:
    charges from one statement are never deduped against each other."""
    today = dt.date(2026, 7, 21)
    charges = [_charge("2026-07-02", 8, 12, amount=250.0, tid="a"),
               _charge("2026-07-02", 9, 12, amount=250.0, tid="b")]
    _wire(monkeypatch, [], charges, cards={"Itaucard": _cyc4()})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    nos = sorted(it["installment_no"] for per in res["periods"] for it in per["items"])
    assert nos == [9, 10, 10, 11, 11, 12, 12]                 # tails of 8/12 AND 9/12


def test_newest_cycle_row_missing_does_not_double_count(monkeypatch):
    """The lag case: the newest statement's charges are booked (parcela 9) before its
    cycle row is ingested (table ends at the prior close). The booked 9 must NOT be
    re-projected on top of the prior statement's 8 — only 10,11,12 project, once."""
    today = dt.date(2026, 8, 10)
    cycles = _cycles(("2026-06-02", "2026-06-09"), ("2026-07-02", "2026-07-09"))  # no Aug row
    charges = [_charge("2026-07-02", 8, 12, amount=300.0, tid="a"),   # prior statement
               _charge("2026-08-02", 9, 12, amount=300.0, tid="b")]   # newest, row not ingested
    _wire(monkeypatch, [], charges, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    nos = sorted(it["installment_no"] for per in res["periods"] for it in per["items"])
    assert nos == [10, 11, 12]                                # from 9, once — never 9 again


def test_un_ingested_last_statement_falls_back_not_blank(monkeypatch):
    """If the most recent statement hasn't been booked yet, the forecast falls back to
    the last statement that WAS booked rather than showing the plan as gone."""
    today = dt.date(2026, 7, 21)
    # cycles know about the 02/07 statement, but only the 02/06 charge is booked
    charges = [_charge("2026-06-02", 5, 12, amount=120.0)]
    _wire(monkeypatch, [], charges, cards={"Itaucard": _cyc4()})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    out = _outstanding(res)
    assert out                                                # not blank — plan survives
    assert min(it["installment_no"] for it in out.values()) == 6  # projects 6..12


def test_tail_beyond_the_cycle_table_is_flagged_not_faked(monkeypatch):
    """Past the last issued statement the exact close date is unknown: the tail falls
    monthly and carries `cycle_projected`, never a fabricated statement date."""
    today = dt.date(2026, 7, 21)
    charges = [_charge("2026-07-02", 10, 12, amount=299.87)]
    cycles = _cycles(("2026-07-02", "2026-07-09"), ("2026-08-02", "2026-08-09"))
    _wire(monkeypatch, [], charges, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    out = _outstanding(res)
    assert out["2026-08-02"].get("flags") is None             # 11/12 — cycle known
    assert out["2026-09-02"]["flags"] == ["cycle_projected"]  # 12/12 — past the table


def test_card_charge_without_a_marker_is_never_projected(monkeypatch):
    """An ordinary one-off card charge (no installment marker) yields no forecast —
    the engine never invents a plan."""
    today = dt.date(2026, 7, 21)
    charges = [_charge("2026-07-02", 0, 0, desc="GROCERIES", amount=88.0)]
    _wire(monkeypatch, [], charges, cards={"Itaucard": _cyc4()})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    assert _outstanding(res) == {}


def test_installment_of_rejects_garbled_markers():
    """A marker with an out-of-range parcela is ignored, not force-fit."""
    assert f._installment_of({"description": "STORE (installment 10/12)", "tags": []}) == (10, 12)
    assert f._installment_of({"description": "STORE (Parcela 3/3)", "tags": []}) == (3, 3)
    assert f._installment_of({"description": "x", "tags": ["installment:12:10"]}) == (10, 12)
    assert f._installment_of({"description": "STORE (installment 13/12)", "tags": []}) is None
    assert f._installment_of({"description": "no marker here", "tags": []}) is None


def test_installment_category_flows_from_the_booked_charge(monkeypatch):
    """The projected rows carry the booked charge's own category — read, not guessed."""
    today = dt.date(2026, 7, 21)
    charges = [_charge("2026-07-02", 10, 12, amount=299.87, cat="Health")]
    _wire(monkeypatch, [], charges, cards={"Itaucard": _cyc4()})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    out = _outstanding(res)
    assert out["2026-08-02"]["category"] == "Health"


def test_open_ended_recurrence_has_no_installment_number(monkeypatch):
    """An open-ended commitment (no nr_of_repetitions) carries neither N nor T."""
    today = dt.date(2026, 7, 12)
    recs = [_rec("Rent", "withdrawal", 5, 1000, "Bank", "LL", "2026-01-05", notes="cmt:rent")]
    _wire(monkeypatch, recs, [])
    res = f.build_projection(granularity="month", start=dt.date(2026, 7, 1),
                             end=dt.date(2026, 7, 31), today=today)
    out = _outstanding(res)
    assert out["2026-07-05"]["installment_no"] is None
    assert out["2026-07-05"]["installment_total"] is None


# ---------- booked transactions (the Reports view) ----------
#
# A report reads the LEDGER, not the projection: every booked transaction in the
# window, exactly as Firefly III recorded it. Nothing matched, nothing settled.


def _booked(tid, date, desc, amount, rtype="withdrawal", cur="BRL",
            src="Checking", dst="Merchant", cat="Groceries"):
    return {"id": tid, "type": rtype, "date": dt.date.fromisoformat(date),
            "amount": amount, "currency": cur, "source": src, "destination": dst,
            "category": cat, "description": desc, "tags": []}


def test_transactions_are_clipped_to_the_exact_window(monkeypatch):
    """`fetch_transactions` widens by MATCH_DAYS so the forecast can see settlements
    just outside the window. A report must NOT inherit that: a July report showing an
    August charge is simply wrong."""
    rows = [_booked("a", "2026-06-29", "before", 10.0),
            _booked("b", "2026-07-01", "first day", 20.0),
            _booked("c", "2026-07-31", "last day", 30.0),
            _booked("d", "2026-08-02", "after", 40.0)]
    monkeypatch.setattr(f, "fetch_transactions", lambda s, e: rows)
    res = f.build_transactions(dt.date(2026, 7, 1), dt.date(2026, 7, 31))
    assert [t["description"] for t in res["transactions"]] == ["first day", "last day"]
    assert res["meta"]["count"] == 2


def test_transactions_totals_are_per_currency_and_never_cross_sum(monkeypatch):
    """Totals are per ISO code. A summed mixed-currency number is a bug and a lie."""
    rows = [_booked("a", "2026-07-02", "rent", 1000.0),
            _booked("b", "2026-07-03", "hosting", 142.0, cur="USD"),
            _booked("c", "2026-07-28", "salary", 5000.0, rtype="deposit")]
    monkeypatch.setattr(f, "fetch_transactions", lambda s, e: rows)
    res = f.build_transactions(dt.date(2026, 7, 1), dt.date(2026, 7, 31))
    assert res["currencies"]["BRL"] == {"out": 1000.0, "in": 5000.0, "net": 4000.0}
    assert res["currencies"]["USD"] == {"out": 142.0, "in": 0.0, "net": -142.0}


def test_transfers_are_listed_but_not_summed_into_in_out(monkeypatch):
    """A transfer moves money between the user's own accounts — it is neither income
    nor expense, so it appears in the list and stays out of the in/out totals."""
    rows = [_booked("a", "2026-07-05", "savings sweep", 2500.0, rtype="transfer",
                    dst="Savings", cat=None)]
    monkeypatch.setattr(f, "fetch_transactions", lambda s, e: rows)
    res = f.build_transactions(dt.date(2026, 7, 1), dt.date(2026, 7, 31))
    assert res["meta"]["count"] == 1
    assert res["transactions"][0]["type"] == "transfer"
    # No in/out entry at all for a currency that only saw transfers — same rule the
    # forecast payload follows. The browser reads the currency set off the rows,
    # so a transfers-only currency still gets its own card.
    assert "BRL" not in res["currencies"]


def test_uncategorised_transaction_keeps_a_null_category(monkeypatch):
    """Firefly leaves the category null when there is none. It is passed through as
    null — the browser buckets those, rather than the engine inventing a label."""
    rows = [_booked("a", "2026-07-05", "mystery", 12.0, cat=None)]
    monkeypatch.setattr(f, "fetch_transactions", lambda s, e: rows)
    res = f.build_transactions(dt.date(2026, 7, 1), dt.date(2026, 7, 31))
    assert res["transactions"][0]["category"] is None


def test_transactions_are_sorted_by_date_then_description(monkeypatch):
    """A stable order out of the engine, so the browser's ranking is deterministic
    when two rows tie on amount."""
    rows = [_booked("a", "2026-07-09", "zebra", 1.0),
            _booked("b", "2026-07-09", "alpha", 2.0),
            _booked("c", "2026-07-02", "middle", 3.0)]
    monkeypatch.setattr(f, "fetch_transactions", lambda s, e: rows)
    res = f.build_transactions(dt.date(2026, 7, 1), dt.date(2026, 7, 31))
    assert [t["description"] for t in res["transactions"]] == ["middle", "alpha", "zebra"]


def test_derived_installment_past_due_date_is_needs_review(monkeypatch):
    """A finite installment's projected tail date can itself fall in the past (the
    statement closed, but nothing has settled it yet). The contract this project
    states — a passed date with nothing accounting for it is `needs_review` — has
    to hold here too, identically to the recurrence path's `elif d < today` rule.

    Hardcoding "upcoming" regardless of `d` was the one place it did not: a
    genuinely overdue installment reported the same status as one due next month,
    so nothing keying off status could tell them apart. Found downstream, where a
    consumer had patched its vendored copy rather than this one."""
    today = dt.date(2026, 8, 15)
    charges = [_charge("2026-06-02", 9, 12, amount=100.0)]
    _wire(monkeypatch, [], charges, cards={"Itaucard": _cyc4()})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    out = _outstanding(res)
    assert out["2026-07-02"]["status"] == "needs_review"   # past due (today is 08-15)
    assert out["2026-08-02"]["status"] == "needs_review"   # past due (08-02 < 08-15)
    assert out["2026-09-02"]["status"] == "upcoming"       # still ahead
    # nothing else about the projection changes
    assert out["2026-09-02"]["installment_no"] == 12
    assert out["2026-08-02"]["mechanism"] == "fatura"
