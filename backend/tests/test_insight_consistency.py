"""Counterexamples reproduce semantic failures seen in real Qwen responses."""

import json

import pytest

from app.services.insight_pack_adapter import PACK_ROOT, InsightPack, _module, build_evidence


def source():
    item = {
        "id": "1",
        "budget": 100,
        "rows": [
            {"dealerId": f"D{i}", "amount": amount} for i, amount in enumerate([40, 30, 20, 10], 1)
        ],
        "otherBudgets": [],
    }
    dealers = [
        {
            "id": f"D{i}",
            "name": f"经销商{i}",
            "history": {
                "yield": y,
                "vol2024": 100,
                "vol2025": 105,
                "c32024": 1000,
                "c32025": 1060,
            },
        }
        for i, y in enumerate([6, 8, 12, 20], 1)
    ]
    return build_evidence(
        {"state": {}, "data": {"dealers": dealers}},
        {"scope": "owner:test", "items": [item]},
        "owner",
        2027,
    )


def result():
    return {
        "schema_version": "1.0",
        "preset_id": "comprehensive",
        "headline": "当前范围分配事实",
        "summary": "预算金额平衡。",
        "blocks": [],
        "limitations": [],
        "checks": [
            {
                "dimension_id": dim,
                "status": "observed",
                "summary": "已有授权事实。",
                "fact_ids": ["budget"],
            }
            for dim in _module.DIMENSIONS
        ],
    }


def block(text, refs, dataset_id=None, title="事实说明"):
    return dict(
        id="b",
        kind="visual" if dataset_id else "finding",
        title=title,
        body=text,
        status="observed",
        dimension_ids=["low_yield"],
        fact_ids=refs,
        dataset_id=dataset_id,
    )


@pytest.mark.parametrize(
    "text",
    [
        "建议进一步核对重复激励。",
        "历史Yield低，需关注投入。",
        "头部集中，需要复核。",
        "不判断异常，但建议确认资源冲突。",
        "高效资源应持续支持。",
    ],
)
def test_normal_case_cannot_turn_observation_into_risk(text):
    data = result()
    data["headline"] = text
    with pytest.raises(ValueError, match="unsupported"):
        InsightPack(PACK_ROOT).validate_consistency(data, source())


@pytest.mark.parametrize(
    "text",
    ["相对位置不代表异常，无需复核。", "未提供未来目标以判定低效。", "未提供未来目标以判定高效。"],
)
def test_negated_risk_is_not_a_positive_claim(text):
    data = result()
    data["headline"] = text
    InsightPack(PACK_ROOT).validate_consistency(data, source())


@pytest.mark.parametrize(
    "text,refs,chart,code",
    [
        ("D1历史Yield为6倍。", ["cohort", "allocated"], "ranked-dealers", "chart_topic_yield"),
        ("D1历史Yield低于中位数。", ["cohort"], "yield-table", "chart_topic_group"),
        ("D1的Vol同比上升。", ["cohort"], None, "missing_trend_reference"),
        ("D1历史Yield为6倍。", ["yield:D2"], None, "unbound_object"),
        ("D1计划投入低于中位数。", ["position:D1"], None, "group_contradiction"),
        ("D1计划投入999元。", ["plan:D1"], None, "unbound_number"),
        ("D1计划投入30元。", ["plan:D1", "plan:D2"], None, "unbound_number"),
        ("D999计划投入40元。", ["plan:D1"], None, "unknown_object"),
    ],
)
def test_inconsistent_claims_are_rejected(text, refs, chart, code):
    data, evidence = result(), source()
    title = next(d["title"] for d in evidence["datasets"] if d["id"] == chart) if chart else "事实"
    data["blocks"] = [block(text, refs, chart, title)]
    with pytest.raises(ValueError, match=code):
        InsightPack(PACK_ROOT).validate_consistency(data, evidence)


def test_bound_facts_and_matching_visual_pass():
    data, evidence = result(), source()
    data["blocks"] = [
        block("", ["cohort", "allocated"], "ranked-dealers", "全量经销商计划投入排序")
    ]
    data["checks"][0].update(summary="D1历史Yield低于中位数。", fact_ids=["position:D1"])
    InsightPack(PACK_ROOT).validate_consistency(data, evidence)


def test_lossless_request_keeps_every_object_null_note_and_scope():
    evidence = source()
    evidence["facts"][0]["custom_test"] = None
    encoded = _module._consistency.compact_evidence(evidence)
    assert _module._consistency.expand_evidence(encoded) == evidence
    request, _ = InsightPack(PACK_ROOT).compile(source())
    encoded = json.loads(request["messages"][1]["content"])["evidence"]
    expected = source()
    expected["datasets"] = [d for d in expected["datasets"] if d["id"] != "budget-compare"]
    assert _module._consistency.expand_evidence(encoded) == expected


def test_new_gate_cannot_be_bypassed_by_lending_other_review_dimension():
    evidence, data = source(), result()
    evidence["check_constraints"][-1].update(allowed_statuses=["review"], required_focus=True)
    data["checks"][-1].update(status="review")
    data["blocks"] = [
        dict(block("预算需要核对。", ["gap"]), status="review", dimension_ids=["completeness"])
    ]
    data["checks"][0].update(summary="建议核对低效投入。", fact_ids=["yield:D1"])
    with pytest.raises(ValueError, match="unsupported"):
        InsightPack(PACK_ROOT).validate_consistency(data, evidence)


def test_tokens_and_audited_citations_do_not_change_claims():
    pack, evidence, data = InsightPack(PACK_ROOT), source(), result()
    data["checks"][0].update(summary="D1历史Yield为{{yield:D1}}倍。", fact_ids=["cohort"])
    bound, tokens = pack.resolve_fact_tokens(data, evidence)
    assert bound["checks"][0]["summary"] == "D1历史Yield为6倍。"
    assert tokens == [{"path": "checks.0.summary", "fact_id": "yield:D1"}]
    data["checks"][0]["summary"] = "D1历史Yield为6倍。"
    cited, audit = pack.bind_named_facts(data, evidence)
    assert cited["checks"][0]["summary"] == data["checks"][0]["summary"]
    assert audit == [{"path": "checks.0.fact_ids", "fact_id": "yield:D1"}]
    pack.validate_consistency(cited, evidence)


@pytest.mark.parametrize(
    "text", ["D1计划投入999元。", "D1历史Yield高于中位数。", "D999历史Yield为6倍。"]
)
def test_citation_completion_cannot_rescue_wrong_claims(text):
    pack, evidence, data = InsightPack(PACK_ROOT), source(), result()
    data["checks"][0].update(summary=text, fact_ids=["cohort"])
    bound, _ = pack.bind_named_facts(data, evidence)
    with pytest.raises(ValueError):
        pack.validate_consistency(bound, evidence)


def test_global_single_initiative_claim_rejects_overlap():
    pack, evidence, data = InsightPack(PACK_ROOT), source(), result()
    next(f for f in evidence["facts"] if f["id"] == "max-initiative-count")["value"] = 2
    data["checks"][3].update(summary="所有经销商均为1个Initiative。", fact_ids=["cohort"])
    bound, _ = pack.bind_named_facts(data, evidence)
    with pytest.raises(ValueError, match="overlap_contradiction"):
        pack.validate_consistency(bound, evidence)


def test_malformed_candidate_rejected_before_binding():
    with pytest.raises(ValueError):
        InsightPack(PACK_ROOT).resolve_fact_tokens({"checks": [None]}, source())


def test_mixed_group_summary_is_rejected():
    pack, evidence, data = InsightPack(PACK_ROOT), source(), result()
    data["blocks"] = [
        block(
            "D1(历史Yield低 / 计划投入高)、D2(历史Yield低 / 计划投入高)、"
            "D3(历史Yield高 / 计划投入低)均属低Yield高投入象限。",
            ["position:D1", "position:D2", "position:D3"],
        )
    ]
    with pytest.raises(ValueError, match="group_contradiction"):
        pack.validate_consistency(data, evidence)


def test_whole_cohort_yield_citations_still_require_uniform_values():
    pack, evidence, data = InsightPack(PACK_ROOT), source(), result()
    data["checks"][0].update(summary="D1等4家经销商历史Yield均为10倍。", fact_ids=["yield:D1"])
    bound, _ = pack.bind_named_facts(data, evidence)
    assert "cohort" in bound["checks"][0]["fact_ids"]
    assert "yield:D4" in bound["checks"][0]["fact_ids"]
    with pytest.raises(ValueError, match="cohort_contradiction"):
        pack.validate_consistency(bound, evidence)
    for fact in evidence["facts"]:
        if fact["id"].startswith("yield:"):
            fact["value"] = 10
    pack.validate_consistency(bound, evidence)


@pytest.mark.parametrize(
    "text,code",
    [
        ("SYN001占比最高，其余五家占比介于8.93%至16.07%之间。", "unprovided_aggregate"),
        ("具体历史数据详见图表。", "missing_visual"),
        ("其余对象见明细表。", "missing_visual"),
    ],
)
def test_unprovided_aggregate_and_absent_figures_rejected(text, code):
    data = result()
    data["summary"] = text
    with pytest.raises(ValueError, match=code):
        InsightPack(PACK_ROOT).validate_consistency(data, source())
