"""Forecast engine — occurrence computation (bounded by nr_of_repetitions) + paid
status by ACCOUNT not amount: Mechanism A ordered-fill (dedicated accounts) and
Mechanism B fatura-driven clearing (credit-card installments). The engine emits the
OUTSTANDING set only (confirmed occurrences already live in Firefly III)."""
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


def test_card_recurrence_ignores_a_stray_settles_tag(monkeypatch):
    """Mechanism-B isolation, enforced by construction: a `settles:` tag on a card
    installment is never consulted — the tag path does not run for a card recurrence.
    Only the cycle settles it."""
    today = dt.date(2026, 7, 21)
    recs = [_rec("Parc", "withdrawal", 15, 300, "Itaucard", "", "2026-06-15",
                 nr=2, notes="cmt:parc")]
    # a stray tag that WOULD clear June if the tag path (wrongly) ran for a card
    txns = [{"id": "stray", "type": "withdrawal", "date": dt.date(2026, 6, 15),
             "amount": 300.0, "currency": "BRL", "source": "Itaucard",
             "destination": "Store", "description": "x",
             "tags": ["settles:parc:2026-06"]}]
    cycles = _cycles(("2026-07-02", "2026-07-09"), ("2026-08-02", "2026-08-09"))
    _wire(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert out["2026-06-15"]["mechanism"] == "fatura"       # B, not tag
    assert out["2026-06-15"]["status"] == "needs_review"    # tag ignored, cycle unpaid


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


def test_card_verdict_holds_under_bound_honoring_fetch(monkeypatch):
    """Mechanism-B regression guard: the widened full-history fetch (now ceilinged at
    `today`, not the display `end`) must not corrupt the card path. Here the display
    window ENDS 30/06 but the June-charge's fatura is paid late on 20/07 — the engine
    must fetch past `end` to `today` and clear it, exactly as window-independence for
    A does. Uses the bound-honoring stub, so a display-window fetch would fail this."""
    today = dt.date(2026, 7, 25)
    recs = [_rec("Parc", "withdrawal", 15, 300, "Itaucard", "", "2026-06-15", nr=2)]
    cycles = _cycles(("2026-07-02", "2026-07-09"), ("2026-08-02", "2026-08-09"))
    txns = [_settlement("late", "2026-07-20", "Itaucard")]
    _wire_ranged(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 6, 30), today=today)
    assert "2026-06-15" not in _outstanding(res)            # cleared via late fatura


def test_fatura_clears_the_cycle_a_charge_fell_in(monkeypatch):
    """A charge on the 9th belongs to the fatura closing on the 12th, which is paid on
    the 20th. Feb–Apr paid → dropped; May open; the count stops at N=4."""
    today = dt.date(2026, 7, 12)
    recs = [_rec("AMZ (parc)", "withdrawal", 9, 300, "Itaucard", "", "2026-02-09", nr=4)]
    txns = [_settlement(f"s{m}", f"2026-{m:02d}-20", "Itaucard") for m in (2, 3, 4)]
    cycles = _monthly_cycles(2026, range(1, 13), 12, 20)
    _wire(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    out = _outstanding(res)
    assert set(out) == {"2026-05-09"}
    assert out["2026-05-09"]["status"] == "needs_review"
    assert out["2026-05-09"]["mechanism"] == "fatura"
    assert out["2026-05-09"]["remaining"] == 1


def test_late_payment_clears_the_cycle_it_belongs_to(monkeypatch):
    """The live regression: a fatura closing 02/07 (charges from 03/06) paid 11 days
    late on 20/07 clears the JUNE-dated charge — not the July one, which belongs to
    the cycle closing 02/08 and is not yet paid."""
    today = dt.date(2026, 7, 21)
    recs = [_rec("Parc", "withdrawal", 15, 300, "Itaucard", "", "2026-06-15", nr=3)]
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
    recs = [_rec("Parc", "withdrawal", 15, 300, "Itaucard", "", "2026-06-15", nr=3)]
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
    recs = [_rec("Parc", "withdrawal", 15, 300, "Itaucard", "", "2026-05-15", nr=3)]
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
    recs = [_rec("Parc", "withdrawal", 15, 300, "Itaucard", "", "2026-06-15", nr=2)]
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
    recs = [_rec("Parc", "withdrawal", 15, 300, "Itaucard", "", "2026-06-15", nr=4)]
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
    recs = [_rec("Parc", "withdrawal", 15, 300, "Itaucard", "", "2026-06-15", nr=2)]
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
    recs = [_rec("Parc", "withdrawal", 15, 300, "Itaucard", "", "2026-06-15", nr=1)]
    cycles = [f.Cycle(dt.date(2026, 7, 2), dt.date(2026, 7, 9), 1000.0)]
    txns = [_settlement("jul", "2026-07-20", "Itaucard")]
    _wire(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 8, 31), today=today)
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
    """A transfer that is NOT into the card must not clear an installment month."""
    today = dt.date(2026, 7, 12)
    recs = [_rec("AMZ (parc)", "withdrawal", 9, 300, "Itaucard", "", "2026-06-09", nr=1)]
    txns = [{"id": "x", "type": "transfer", "date": dt.date(2026, 6, 8),
             "amount": 9.0, "currency": "BRL", "source": "Itaucard",
             "destination": "Savings", "description": "not a fatura", "tags": []}]
    _wire(monkeypatch, recs, txns,
          cards={"Itaucard": _monthly_cycles(2026, range(1, 13), 2, 9)})
    res = f.build_projection(granularity="month", start=dt.date(2026, 1, 1),
                             end=dt.date(2026, 12, 31), today=today)
    out = _outstanding(res)
    assert out["2026-06-09"]["status"] == "needs_review"   # still open


def test_first_cycle_does_not_swallow_older_charges(monkeypatch):
    """The earliest row opens where the spacing to the next says it does. A charge
    from before that is not in it, and paying that fatura must not clear it."""
    today = dt.date(2026, 7, 21)
    recs = [_rec("Parc", "withdrawal", 9, 300, "Itaucard", "", "2026-04-09", nr=4)]
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
    recs = [_rec("Parc", "withdrawal", 20, 300, "Itaucard", "", "2026-06-20", nr=4)]
    cycles = _cycles(("2026-06-02", "2026-06-09"), ("2026-07-02", "2026-07-09"))
    txns = []
    _wire(monkeypatch, recs, txns, cards={"Itaucard": cycles})
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 9, 30), today=today)
    out = _outstanding(res)
    assert out["2026-06-20"].get("flags") is None            # covered by the table
    assert out["2026-08-20"]["flags"] == ["cycle_unknown"]   # beyond it


def test_installment_number_is_position_in_full_series(monkeypatch):
    """N/T: T = nr_of_repetitions; N = the occurrence's 1-based place counted from
    first_date across the WHOLE series, independent of the display window. A 10-part
    installment starting 2026-01-09, shown only from May, must read 5/10..8/10 — not
    1/10 at the window's first visible row."""
    today = dt.date(2026, 7, 12)
    recs = [_rec("Parc 10x", "withdrawal", 9, 300, "Itaucard", "", "2026-01-09", nr=10)]
    _wire(monkeypatch, recs, [], cards={"Itaucard": []})   # no cycles → nothing cleared
    res = f.build_projection(granularity="month", start=dt.date(2026, 5, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert out["2026-05-09"]["installment_no"] == 5
    assert out["2026-05-09"]["installment_total"] == 10
    assert out["2026-08-09"]["installment_no"] == 8
    assert all(it["installment_total"] == 10
               for per in res["periods"] for it in per["items"])


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
