import copy
import json

from app.services.insight_pack_adapter import PACK_ROOT, InsightPack, build_evidence
from test_insight_investment import item, record

HISTORY_IDENTITY = {"role": "owner", "affiliation_sector": "PCMO", "affiliation_department": "MKT"}


def evidence(rows):
    items = [
        item((i + 1) * 100000, code=row["id"], identifier=str(i)) for i, row in enumerate(rows)
    ]
    return build_evidence(
        {"identity": HISTORY_IDENTITY, "data": {"dealers": rows}},
        {"scope": "owner:test", "items": items}, "owner", 2027
    )


def test_sector_metrics_survive_restricted_resource_amount():
    pcmo = record("D1", sector="PCMO", **{"SP&A": 10000})
    pcmo["history"]["resources2025"].pop("MRD")
    pcmo["history"].update(
        yield_value=2.5, vol2025=12000, restrictedResources2025=["MRD", "Capex"]
    )
    pcmo["history"]["yield"] = pcmo["history"].pop("yield_value")
    crto = record("D1", sector="CRTO")
    crto["history"].update({"yield": 3, "vol2025": 24000})
    data = build_evidence(
        {"identity": HISTORY_IDENTITY, "data": {"dealers": [crto, pcmo]}},
        {"scope": "owner:test", "items": [item(295987.72, sector="PCMO")]},
        "owner",
        2027,
    )
    facts = {f["id"]: f["value"] for f in data["facts"]}
    assert facts["yield:D1"] == 2.5
    assert facts["vol2025:D1"] == 12000
    assert not any(d["id"] == "investment-review" for d in data["datasets"])
    assert not any(key.startswith("investment") for key in facts)
    pack = InsightPack(PACK_ROOT)
    for preset in ["comprehensive", "quadrant"]:
        projected = pack.model_evidence(data, preset)
        assert not any(f["id"].startswith("investment") for f in projected["facts"])
        assert "resource_restricted" not in json.dumps(projected)
    # A visible source null remains missing, never mislabelled as a permission issue.
    pcmo["history"]["restrictedResources2025"] = ["Capex"]
    pcmo["history"]["resources2025"]["MRD"] = None
    other = build_evidence(
        {"identity": HISTORY_IDENTITY, "data": {"dealers": [pcmo]}},
        {"scope": "owner:test", "items": [item(295987.72, sector="PCMO")]},
        "owner",
        2027,
    )
    assert (
        next(d for d in other["datasets"] if d["id"] == "investment-review")["rows"][0][
            "reason_code"
        ]
        == "missing"
    )


def test_mixed_resources_only_compare_authorized_amounts():
    dealer = record(actual=100000, **{"SP&A": 100000})
    dealer["history"].update({"yield": 2.5, "restrictedResources2025": ["MRD"]})
    data = build_evidence(
        {"identity": HISTORY_IDENTITY, "data": {"dealers": [dealer]}},
        {"scope": "owner:test", "items": [item(), item(resource="SP&A", identifier="2")]},
        "owner", 2027,
    )
    rows = next(d for d in data["datasets"] if d["id"] == "investment-review")["rows"]
    assert len(rows) == 1 and rows[0]["resource_type"] == "SP&A"
    facts = {f["id"]: f["value"] for f in data["facts"]}
    assert facts["investment-comparison-count"] == facts["investment-review-count"] == 1
    assert facts["allocated"] == 2000000 and facts["yield:D1"] == 2.5


def test_department_permission_skips_resource_even_without_history_rows():
    workspace = {
        "identity": {
            "role": "owner", "department": ["ICE"],
            "affiliation_sector": "PCMO", "affiliation_department": "ICE",
        },
        "data": {"dealers": []},
    }
    descriptor = {"scope": "owner:test", "items": [item()]}
    data = build_evidence(workspace, descriptor, "owner", 2027)
    assert not any(f["id"].startswith("investment") for f in data["facts"])
    # Business scope does not grant expense access. An explicit user override does;
    # source absence remains missing history rather than being silently skipped.
    workspace["identity"]["history_resources"] = ["MRD"]
    data = build_evidence(workspace, descriptor, "owner", 2027)
    rows = next(d for d in data["datasets"] if d["id"] == "investment-review")["rows"]
    assert rows[0]["reason_code"] == "missing"
    workspace["identity"].pop("history_resources")
    workspace["state"] = {"departmentResources": {"ICE": ["MRD"]}}
    data = build_evidence(workspace, descriptor, "owner", 2027)
    assert any(d["id"] == "investment-review" for d in data["datasets"])


def test_zero_yield_not_in_examples_or_quadrant_but_source_and_amounts_unchanged():
    rows = [record(f"D{i}") for i in range(5)]
    for i, row in enumerate(rows):
        row["history"].update({"yield": i, "vol2024": 100, "vol2025": 110})
    original = copy.deepcopy(rows)
    data = evidence(rows)
    facts = {f["id"]: f["value"] for f in data["facts"]}
    assert facts["yield:D0"] == 0 and facts["cohort"] == 5
    assert facts["allocated"] == 1500000
    chart = next(d for d in data["datasets"] if d["id"] == "yield-plan")
    assert {r["id"] for r in chart["rows"]} == {"D1", "D2", "D3", "D4"}
    assert chart["x"]["cutoff"] == 2.5
    assert chart["population_count"] == 5 and chart["excluded_count"] == 1
    pack = InsightPack(PACK_ROOT)
    for preset in ["comprehensive", "quadrant"]:
        body, _ = pack.compile(data, preset)
        assert "yield:D0" not in json.dumps(body)
        anchors = pack.execution_anchor(pack.model_evidence(data, preset), preset)
        assert (
            next(c for c in anchors["checks"] if c["dimension_id"] == "low_yield")["entity_id"]
            == "D1"
        )
    assert rows == original


def test_all_zero_yield_is_excluded_not_relabelled_missing_history():
    row = record()
    row["history"]["yield"] = 0
    data = evidence([row])
    pack = InsightPack(PACK_ROOT)
    projected = pack.model_evidence(data)
    anchors = pack.execution_anchor(projected, "comprehensive")
    low = next(c for c in anchors["checks"] if c["dimension_id"] == "low_yield")
    assert "零值不参与" in low["summary"]
    assert "未提供" not in low["summary"]
    assert any(d["id"] == "investment-review" for d in data["datasets"])


def test_yield_units_and_negative_suppression_do_not_change_investment_units():
    rows = [record(f"D{i}") for i in range(5)]
    for index, row in enumerate(rows):
        row["history"].update({"yield": index - 1, "c32025": 100, "vol2025": 200})
    original = copy.deepcopy(rows)
    data = evidence(rows)
    facts = {f["id"]: f for f in data["facts"]}
    assert facts["yield:D0"]["value"] is None
    assert facts["yield:D2"]["value"] == 1
    assert facts["yield:D2"]["unit"] == "USD/USD"
    assert "未" in facts["yield:D2"]["note"]
    assert facts["plan:D2"]["unit"] == "CNY"
    assert facts["c32025:D2"]["unit"] == "USD"
    assert facts["vol2025:D2"]["unit"] == "L"
    table = next(d for d in data["datasets"] if d["id"] == "yield-table")
    assert next(c for c in table["columns"] if c["key"] == "yield_value")["unit"] == "USD/USD"
    assert next(r for r in table["rows"] if r["id"] == "D0")["yield_value"] is None
    pack = InsightPack(PACK_ROOT)
    body, _ = pack.compile(data)
    task = json.loads(body["messages"][1]["content"])
    assert task["display_values"]["yield:D2"] == "1.0"
    low = next(
        c for c in task["task"]["execution_anchor"]["checks"]
        if c["dimension_id"] == "low_yield"
    )
    assert low["entity_id"] == "D2"
    assert "倍" not in low["summary"]
    assert rows == original
