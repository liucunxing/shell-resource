"""Business evidence regressions found in the 2026-10-11 real Qwen evaluation."""

import pytest

from app.services.insight_pack_adapter import build_evidence


def evidence(history=None, note="已明确用途", other=20):
    item = {
        "id": "1",
        "name": "合成项目",
        "budget": 100,
        "rows": [{"dealerId": "D1", "amount": 80}],
        "otherBudgets": [{"reasonId": "reserve", "amount": other, "note": note}],
    }
    workspace = {
        "state": {"guide": {}, "budgetReasons": []},
        "data": {"dealers": [{"id": "D1", "history": history or {}}]},
    }
    return build_evidence(workspace, {"scope": "owner:test", "items": [item]}, "owner", 2027)


def test_balanced_amount_does_not_hide_missing_other_budget_explanation():
    data = evidence(note="  ")
    facts = {f["id"]: f for f in data["facts"]}
    completeness = next(c for c in data["check_constraints"] if c["dimension_id"] == "completeness")
    assert facts["gap"]["value"] == 0
    assert facts["missing-other-notes"]["value"] == 1
    assert completeness["allowed_statuses"] == ["review"]
    assert completeness["required_focus"] is True


@pytest.mark.parametrize("start,end", [(0, 100), (-10, 20), (10, 0), (10, -5)])
def test_observed_year_pair_includes_zero_and_negative_values(start, end):
    data = evidence({"vol2024": start, "vol2025": end})
    facts = {f["id"]: f for f in data["facts"]}
    trend = next(c for c in data["check_constraints"] if c["dimension_id"] == "trend")
    assert trend["allowed_statuses"] == ["observed"]
    assert facts["vol-change:D1"]["value"] == end - start
    assert facts["vol-growth:D1"]["value"] == ((end - start) / start if start > 0 else None)


def test_ratios_and_annual_changes_are_provided_with_explicit_denominators():
    data = evidence({"vol2024": 100, "vol2025": 90, "c32024": 50, "c32025": 60})
    facts = {f["id"]: f for f in data["facts"]}
    assert facts["share:D1"]["value"] == 1
    assert facts["share:D1"]["unit"] == "ratio"
    assert "经销商分配" in facts["share:D1"]["note"]
    assert facts["vol-growth:D1"]["value"] == -0.1
    assert facts["c3-growth:D1"]["value"] == 0.2
    assert facts["arranged"]["value"] == 100


def test_fully_documented_other_budget_keeps_amount_check_clear():
    data = evidence()
    completeness = next(c for c in data["check_constraints"] if c["dimension_id"] == "completeness")
    assert completeness["allowed_statuses"] == ["clear", "observed"]
    assert completeness["required_focus"] is False
