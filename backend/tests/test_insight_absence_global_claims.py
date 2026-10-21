"""Guard valid absence/global clauses without allowing invented or misbound values."""

import importlib.util

import pytest

from app.services.insight_pack_adapter import PACK_ROOT

spec = importlib.util.spec_from_file_location("claim_guards", PACK_ROOT / "scripts/consistency.py")
guards = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guards)


def check(
    summary, facts, *, dimension="concentration", status="observed", refs=None, overview=False
):
    evidence = {
        "planning_year": 2027,
        "facts": [
            {"id": key, "label": key, "value": value, "unit": "", "period": "2025全年"}
            for key, value in facts.items()
        ],
        "datasets": [],
        "check_constraints": [{"dimension_id": dimension, "allowed_statuses": [status]}],
    }
    result = {
        "headline": "事实检查",
        "summary": "",
        "blocks": [],
        "checks": [
            {
                "dimension_id": dimension,
                "status": status,
                "summary": summary,
                "fact_ids": list(facts) if refs is None else refs,
            }
        ],
    }
    if overview:
        result["summary"] = summary
        result["checks"] = []
    return guards.issues(result, evidence)


@pytest.mark.parametrize("summary", ["未提供2025历史Yield", "缺少历史整体Yield数据"])
def test_limited_absence_is_supported_by_missing_authorized_history(summary):
    assert not check(summary, {"yield:D1": None}, dimension="low_yield", status="limited", refs=[])


@pytest.mark.parametrize(
    "summary,facts,status",
    [
        ("未提供2025历史Yield", {"yield:D1": 2.0}, "limited"),
        ("未提供2025历史Yield", {"yield:D1": None}, "observed"),
        ("未提供2025历史Yield，Yield为99倍", {"yield:D1": None}, "limited"),
        ("D1未提供历史Yield", {"yield:D1": None}, "limited"),
    ],
)
def test_absence_exception_does_not_allow_known_values_or_unbound_claims(summary, facts, status):
    assert check(summary, facts, dimension="low_yield", status=status, refs=[])


@pytest.mark.parametrize(
    "summary",
    [
        "D1计划投入10万元，负责预算20万元",
        "D1计划投入10万元，总预算为20万元",
        "D1计划投入10万元，负责预算200,000元",
    ],
)
def test_explicit_global_budget_keeps_its_own_citation(summary):
    assert not check(summary, {"plan:D1": 100000, "budget": 200000})


@pytest.mark.parametrize(
    "summary,refs",
    [
        ("D1计划投入20万元，负责预算20万元", ["plan:D1", "budget"]),
        ("D1计划投入10万元，负责预算10万元", ["plan:D1", "budget"]),
        ("D1计划投入10万元，负责预算20万元", ["plan:D1"]),
        ("D1计划投入10万元，投入20万元", ["plan:D1", "budget"]),
    ],
)
def test_global_clause_does_not_justify_wrong_or_uncited_amount(summary, refs):
    assert check(summary, {"plan:D1": 100000, "budget": 200000}, refs=refs)


@pytest.mark.parametrize(
    "summary,facts",
    [
        (
            "D1、D2与D3分别占经销商分配的50%、30%和20%",
            {"share:D1": 0.5, "share:D2": 0.3, "share:D3": 0.2},
        ),
        ("D1与D2分别计划投入10万元和20万元", {"plan:D1": 100000, "plan:D2": 200000}),
    ],
)
def test_explicit_ordered_list_binds_each_value_to_its_own_metric(summary, facts):
    assert not check(summary, facts)


@pytest.mark.parametrize(
    "summary",
    [
        "D1、D2与D3分别占经销商分配的30%、50%和20%",
        "D1、D2与D3分别占经销商分配的50%和30%",
        "D1、D2与D3分别占经销商分配的50%、30%、20%和10%",
        "D1、D2与D3分别占经销商分配的50%、30%和99%",
    ],
)
def test_ordered_shares_reject_swapped_missing_extra_or_invented_values(summary):
    assert check(summary, {"share:D1": 0.5, "share:D2": 0.3, "share:D3": 0.2})


def test_ordered_list_does_not_use_uncited_or_different_metric_values():
    facts = {"share:D1": 0.5, "share:D2": 0.3, "plan:D1": 100000, "plan:D2": 200000}
    assert check("D1与D2分别占经销商分配的50%和30%", facts, refs=["share:D1"])
    assert check("D1与D2分别计划投入20万元和10万元", facts)
    assert check("D1与D2分别计划投入0.5元和0.3元", facts)


@pytest.mark.parametrize("overview", [False, True])
def test_ordered_list_with_explicit_cohort_prefix(overview):
    facts = {"share:D1": 0.5, "share:D2": 0.3, "share:D3": 0.2, "cohort": 3}
    text = "在3家计划分配经销商中，D1、D2与D3分别占经销商分配的50%、30%和20%"
    assert not check(text, facts, overview=overview)
    assert check(text.replace("在3家", "在4家"), facts, overview=overview)
    assert check(text.replace("50%、30%", "30%、50%"), facts, overview=overview)


@pytest.mark.parametrize(
    "summary", ["有0项投入变化需要确认", "0项投入变化需复核", "未触发投入变化复核规则"]
)
def test_zero_review_count_is_not_a_positive_review_action(summary):
    assert not check(summary, {"investment-review-count": 0})


@pytest.mark.parametrize(
    "summary,facts,refs",
    [
        ("有0项投入变化需要确认", {"investment-review-count": 1}, ["investment-review-count"]),
        ("有0项投入变化需要确认", {"investment-review-count": 0}, []),
        (
            "有0项投入变化需要确认，但需要复核预算",
            {"investment-review-count": 0},
            ["investment-review-count"],
        ),
        (
            "有0项投入变化需要确认，建议核对预算",
            {"investment-review-count": 0},
            ["investment-review-count"],
        ),
        ("未触发规则，但需要复核预算", {"investment-review-count": 0}, ["investment-review-count"]),
    ],
)
def test_zero_review_count_does_not_hide_unbound_or_positive_actions(summary, facts, refs):
    assert check(summary, facts, refs=refs)


def test_no_trigger_statement_requires_cited_zero_count():
    assert check("未触发投入变化复核规则", {"investment-review-count": 1})
    assert check("未触发投入变化复核规则", {"investment-review-count": 0}, refs=[])


@pytest.mark.parametrize("value,rendered", [(5, "5"), (5.6, "5.6"), (0, "0"), (-5.6, "-5.6")])
@pytest.mark.parametrize("space", ["", " "])
def test_yield_adjacent_number_is_read_as_a_complete_value(value, rendered, space):
    facts = {"yield:D1": value}
    assert not check(f"D1历史Yield{space}{rendered}倍", facts)
    assert check(f"D1历史Yield{space}99.8倍", facts)


def test_yield_label_normalization_does_not_parse_known_dealer_id_digits():
    assert not check("Yield5.6历史Yield 2倍", {"yield:Yield5.6": 2})
    assert check("Yield5.6历史Yield 5.6倍", {"yield:Yield5.6": 2})


@pytest.mark.parametrize(
    "text",
    [
        "部分经销商无历史Yield",
        "没有历史整体Yield数据",
        "未提供2025历史Yield",
        "缺少历史Yield",
        "缺失历史Yield数据",
    ],
)
def test_complete_known_yield_population_rejects_missing_history_claim(text):
    errors = check(text, {"cohort": 2, "yield:D1": 0, "yield:D2": 5.6}, overview=True)
    assert any("historical_yield_absence_contradiction" in error for error in errors)


@pytest.mark.parametrize(
    "text,facts",
    [
        ("部分经销商无历史Yield", {"cohort": 3, "yield:D1": 0, "yield:D2": 5.6}),
        ("部分经销商无历史Yield", {"cohort": 2, "yield:D1": None, "yield:D2": 5.6}),
        ("未提供未来Yield和未来目标", {"cohort": 2, "yield:D1": 0, "yield:D2": 5.6}),
        ("2024年未提供历史Yield", {"cohort": 2, "yield:D1": 0, "yield:D2": 5.6}),
        ("并非没有历史Yield", {"cohort": 2, "yield:D1": 0, "yield:D2": 5.6}),
    ],
)
def test_historical_absence_guard_does_not_infer_missing_population_or_other_periods(text, facts):
    errors = check(text, facts, overview=True)
    assert not any("historical_yield_absence_contradiction" in error for error in errors)

@pytest.mark.parametrize("metric", ["yield:D1", "vol2025:D1", "c32025:D1"])
def test_restricted_amount_does_not_mean_no_history(metric):
    errors = check("D1无历史数据。", {metric: 5.59}, overview=True)
    assert any("history_absence_contradiction" in error for error in errors)
    assert not check("D1的MRD历史投入金额未授权，不代表无历史数据。", {metric: 5.59}, overview=True)
