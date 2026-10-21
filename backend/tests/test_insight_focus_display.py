"""Mandatory focus decoding and display conversions preserve factual validation."""

import copy
import json

import pytest
from jsonschema import Draft202012Validator

from app.services.insight_pack_adapter import PACK_ROOT, InsightPack


@pytest.mark.parametrize(
    "candidate",
    [
        None,
        [],
        {},
        {"blocks": None},
        {"blocks": {}},
        {"blocks": [3]},
        {"blocks": [], "required_findings": []},
        {"blocks": [], "required_findings": {"completeness": None}},
    ],
)
def test_malformed_wire_result_uses_controlled_validation_error(candidate):
    from app.services.insight_pack_adapter import PackError

    with pytest.raises(PackError):
        InsightPack(PACK_ROOT).unpack_model_result(candidate)


def example(scene="overspend", preset="comprehensive"):
    evidence = json.loads(
        (PACK_ROOT / f"examples/{scene}.evidence.json").read_text(encoding="utf-8")
    )
    result = json.loads((PACK_ROOT / f"examples/{scene}.{preset}.json").read_text(encoding="utf-8"))
    return evidence, result


def test_provider_requires_independent_review_finding_even_when_overview_mentions_it():
    pack = InsightPack(PACK_ROOT)
    evidence, result = example()
    body, _ = pack.compile(evidence)
    validator = Draft202012Validator(body["response_format"]["json_schema"]["schema"])
    assert list(validator.iter_errors(result))
    finding = next(b for b in result["blocks"] if b["status"] == "review")
    wire = copy.deepcopy(result)
    wire["blocks"] = []
    present = {f["id"] for f in evidence["facts"] if f["value"] is not None}
    for check in wire["checks"]:
        if check["status"] != "limited":
            check["fact_ids"] = [key for key in check["fact_ids"] if key in present]
    wire["required_findings"] = {
        "completeness": {
            **finding,
            "id": "focus-completeness",
            "dimension_ids": ["completeness"],
            "dataset_id": None,
            "kind": "finding",
        }
    }
    validator.validate(wire)
    unpacked = pack.unpack_model_result(wire)
    assert "required_findings" not in unpacked
    assert wire["blocks"] == []
    pack.validate_result(unpacked, evidence)
    for key, value in [("body", ""), ("status", "observed"), ("fact_ids", ["invented"])]:
        invalid = copy.deepcopy(wire)
        invalid["required_findings"]["completeness"][key] = value
        assert list(validator.iter_errors(invalid))
    unpacked["blocks"] = []
    with pytest.raises(ValueError, match="required_focus.completeness"):
        pack.validate_result(unpacked, evidence)


def test_display_values_do_not_change_source_amounts_yield_or_grouping():
    pack = InsightPack(PACK_ROOT)
    evidence, _ = example("baseline")
    frozen = copy.deepcopy(evidence)
    body, _ = pack.compile(evidence)
    request = json.loads(body["messages"][1]["content"])
    money = next(f for f in evidence["facts"] if f["unit"] == "CNY")
    assert request["display_values"][money["id"]].endswith("万元")
    assert evidence == frozen
    assert "required_findings" not in body["response_format"]["json_schema"]["schema"]["required"]


def test_quadrant_object_mode_keeps_the_same_authorized_schema_and_required_findings():
    pack = InsightPack(PACK_ROOT)
    evidence, _ = example()
    body, metadata = pack.compile(evidence, "quadrant")
    strict, _ = pack.compile(evidence, "quadrant", response_format="schema")
    assert body["response_format"] == {"type": "json_object"}
    assert body["stream"] is False
    assert metadata["response_format"] == "object"
    schema = json.loads(body["messages"][0]["content"].split("返回的 JSON 须符合此结构：\n")[1])
    assert schema == strict["response_format"]["json_schema"]["schema"]
    assert "required_findings" in schema["required"]
    assert pack.compile(evidence, "structure")[0]["response_format"]["type"] == "json_schema"


def test_nonlimited_schema_cannot_only_cite_a_missing_rule_value():
    pack = InsightPack(PACK_ROOT)
    evidence, result = example("baseline")
    evidence["facts"].append({**evidence["facts"][0], "id": "absent-rule", "value": None})
    body, _ = pack.compile(evidence)
    validator = Draft202012Validator(body["response_format"]["json_schema"]["schema"])
    result["checks"][2].update(status="observed", fact_ids=["absent-rule"])
    assert list(validator.iter_errors(result))


def test_money_conversion_is_exact_idempotent_and_yield_is_one_decimal():
    pack = InsightPack(PACK_ROOT)
    _, result = example("baseline")
    result["summary"] = (
        "实际100,000元，计划1,000,000元，增加900,000元；历史Yield为2.345倍。差额-0.01元，缺失不填0。"
    )
    formatted = pack.format_result_display(result)
    assert (
        formatted["summary"]
        == "实际10万元，计划100万元，增加90万元；历史Yield为2.3倍。差额-0.000001万元，缺失不填0。"
    )
    assert pack.format_result_display(formatted) == formatted
    assert "100,000元" in result["summary"]


def test_real_qwen_required_findings_with_numbered_list_and_wan_amounts():
    pack = InsightPack(PACK_ROOT)
    evidence = json.loads(
        (PACK_ROOT / "tests/fixtures/synthetic_model_replay.json").read_text(encoding="utf-8")
    )["evidence"]
    wire = json.loads(
        (PACK_ROOT / "tests/fixtures/mandatory-focus-money.json").read_text(encoding="utf-8")
    )
    result = pack.unpack_model_result(wire)
    # The captured response predates removal of the comprehensive budget visual.
    # Keep its financial prose regression while adapting the retired visual only.
    result["blocks"] = [b for b in result["blocks"] if b.get("dataset_id") != "budget-compare"]
    result, _ = pack.resolve_fact_tokens(result, evidence)
    result, _ = pack.bind_named_facts(result, evidence)
    pack.validate_consistency(result, evidence)
    invalid = copy.deepcopy(result)
    invalid["blocks"][0]["body"] = invalid["blocks"][0]["body"].replace(
        "计划100万元", "计划999万元"
    )
    with pytest.raises(ValueError, match="unbound_number"):
        pack.validate_consistency(invalid, evidence)


def test_money_tokens_bind_authorized_fields_and_convert_units_once():
    pack = InsightPack(PACK_ROOT)
    evidence, result = example("baseline")
    row_id = "investment:row"
    evidence["facts"].append(
        {
            **evidence["facts"][0],
            "id": row_id,
            "unit": "",
            "value": json.dumps({"historical_actual": 100000, "plan": 1000000, "delta": 900000}),
        }
    )
    result["summary"] = (
        "实际{{investment:row.historical_actual}}万元，计划{{investment:row.plan}}万元，增加{{investment:row.delta}}万元。"
    )
    pack.validate_model_references(result, evidence)
    rendered, bindings = pack.resolve_fact_tokens(result, evidence)
    assert rendered["summary"] == "实际10万元，计划100万元，增加90万元。"
    assert {b["fact_id"] for b in bindings} == {row_id}
    for token in ["investment:row.secret", "investment:outside.plan"]:
        result["summary"] = "{{" + token + "}}万元"
        with pytest.raises(ValueError):
            pack.validate_model_references(result, evidence)
        with pytest.raises(ValueError, match="unknown_fact_token"):
            pack.resolve_fact_tokens(result, evidence)


def test_scalar_money_tokens_keep_legacy_yuan_and_support_wan():
    pack = InsightPack(PACK_ROOT)
    evidence, result = example("baseline")
    evidence["facts"][0].update(id="budget", value=100000, unit="CNY")
    result["summary"] = "{{budget}}万元 / {{budget}}元 / {{budget}}"
    resolved, _ = pack.resolve_fact_tokens(result, evidence)
    assert resolved["summary"] == "10万元 / 100000元 / 10万元"
