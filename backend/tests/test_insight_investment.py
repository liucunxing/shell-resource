from app.services.insight_investment import InvestmentRules, investment_comparisons
from app.services.insight_pack_adapter import build_evidence


def record(code="D1", actual=100000, sector="B2B", **resources):
    return {
        "id": code,
        "name": code,
        "sector": sector,
        "history": {"resources2025": {"MRD": actual, **resources}},
    }


def item(amount=1000000, sector="B2B", resource="MRD", code="D1", identifier="1"):
    return {
        "id": identifier,
        "sector": sector,
        "resourceType": resource,
        "budget": amount,
        "rows": [{"dealerId": code, "amount": amount}],
    }


def compare(records=None, items=None):
    return investment_comparisons(records or [record()], items or [item()], InvestmentRules())


def test_ten_to_hundred_thousand_is_deterministic_review():
    row = compare()[0]
    assert (row["historical_actual"], row["plan"], row["delta"], row["multiple"]) == (
        100000,
        1000000,
        900000,
        10,
    )
    assert row["status"] == "review"
    evidence = build_evidence(
        {"data": {"dealers": [record()]}}, {"scope": "owner:test", "items": [item()]}, "owner", 2027
    )
    trend = next(c for c in evidence["check_constraints"] if c["dimension_id"] == "trend")
    assert trend["allowed_statuses"] == ["review"]
    assert trend["required_focus"] is True
    dataset = next(d for d in evidence["datasets"] if d["id"] == "investment-review")
    assert dataset["rows"][0] == row
    assert "2025" in dataset["period"] and "2027" in dataset["period"]
    assert "非精确单项目历史" in dataset["note"]


def test_historical_unallocated_is_included_only_in_authorized_pairs():
    rows = compare([record(), record("D2"), record("PRIVATE", sector="B2C")])
    assert {r["dealer_id"] for r in rows} == {"D1", "D2"}
    assert rows[1]["reason_code"] == "unallocated"
    assert rows[1]["plan"] == 0


def test_zero_missing_and_new_investment_are_distinct():
    assert compare([record(actual=0)])[0]["reason_code"] == "new_investment"
    assert compare([record(actual=0)])[0]["status"] == "observed"
    assert compare([record(actual=None)])[0]["historical_actual"] is None
    assert compare([record(actual=None)])[0]["status"] == "limited"
    assert compare([record(actual=0)], [item(amount=0)])[0]["status"] == "observed"


def test_projects_aggregate_baseline_once_and_scope_resources():
    rows = compare([record(**{"Capex": 9999999})], [item(60000), item(50000, identifier="2")])
    assert len(rows) == 1
    assert rows[0]["plan"] == 110000
    assert rows[0]["historical_actual"] == 100000
    assert "9999999" not in str(rows)


def test_cross_sector_records_do_not_mix_and_ambiguity_is_limited():
    rows = compare([record(), record(actual=10, sector="B2C")])
    assert rows[0]["historical_actual"] == 100000
    assert compare([record(), record(sector=None)])[0]["status"] == "limited"
    assert compare([record(), record()])[0]["status"] == "limited"
    assert compare([record()], [item(sector="")])[0]["status"] == "limited"


def test_absolute_threshold_and_configurable_rules():
    assert compare([record(actual=100)], [item(1000)])[0]["status"] == "observed"
    assert compare(items=[item(40000)])[0]["reason_code"] == "decrease"
    rows = investment_comparisons([record()], [item()], InvestmentRules(absolute_change=2000000))
    assert rows[0]["status"] == "observed"


def test_missing_authorized_history_does_not_fall_back_to_other_resource():
    rows = compare([record(actual=None, Capex=100000)], [item()])
    assert rows[0]["status"] == "limited"
    assert rows[0]["historical_actual"] is None


def test_absolute_delta_is_source_computed_and_missing_stays_null():
    decrease = compare(items=[item(30000)])[0]
    assert decrease["delta"] == -70000
    assert decrease["abs_delta"] == 70000
    assert compare()[0]["abs_delta"] == 900000
    assert compare([record(actual=None)])[0]["abs_delta"] is None
