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


def _rec(title, rtype, moment, amount, src, dst, first, nr=None, notes=None, cur="BRL"):
    return {"attributes": {
        "active": False, "type": rtype, "title": title, "notes": notes,
        "first_date": first, "repeat_until": None, "nr_of_repetitions": nr,
        "repetitions": [{"type": "monthly", "moment": str(moment), "skip": 0}],
        "transactions": [{"amount": str(amount), "currency_code": cur,
                          "source_name": src, "destination_name": dst,
                          "category_name": None}]}}


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


def test_ordered_fill_confirmed_dropped_outstanding_kept(monkeypatch):
    """Ordered-fill: two payments clear the two earliest occurrences (dropped from
    the outstanding payload); later months remain needs_review/upcoming."""
    today = dt.date(2026, 7, 12)
    recs = [_rec("Rent", "withdrawal", 5, 1000, "Bank", "Landlord", "2026-01-05")]
    txns = [{"id": "a", "type": "withdrawal", "date": dt.date(2026, 6, 30),
             "amount": 950.0, "currency": "BRL", "source": "bank",
             "destination": "LANDLORD", "description": "r", "tags": []},
            {"id": "b", "type": "withdrawal", "date": dt.date(2026, 7, 3),
             "amount": 1100.0, "currency": "BRL", "source": "Bank",
             "destination": "Landlord", "description": "r", "tags": []}]
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 5, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert "2026-05-05" not in out and "2026-06-05" not in out   # paid → dropped
    assert out["2026-07-05"]["status"] == "needs_review"
    assert out["2026-08-05"]["status"] == "upcoming"


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


def test_noisy_account_surfaces_not_silently_cleared(monkeypatch):
    """A noisy account (more identifying payments than occurrences, no slug) must NOT
    be auto-cleared and dropped — its occurrences stay open, flagged, for review."""
    today = dt.date(2026, 8, 1)
    recs = [_rec("Housekeeper", "withdrawal", 5, 1100, "Bank", "Maria", "2026-06-05")]
    txns = [{"id": f"t{i}", "type": "withdrawal", "date": dt.date(2026, 6, 5 + i),
             "amount": 50.0, "currency": "BRL", "source": "bank", "destination": "MARIA",
             "description": "pix", "tags": []} for i in range(5)]   # 5 txns > 3 occ
    _wire(monkeypatch, recs, txns)
    res = f.build_projection(granularity="month", start=dt.date(2026, 6, 1),
                             end=dt.date(2026, 8, 31), today=today)
    out = _outstanding(res)
    assert out, "flagged commitment must not vanish from the outstanding set"
    assert all(it.get("flags") == ["noisy_account"] for it in out.values())
    assert out["2026-06-05"]["status"] == "needs_review"   # not silently 'paid'


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
