import copy
import json

from app.services.insight_pack_adapter import PACK_ROOT, InsightPack, build_evidence
from test_insight_investment import item, record


def evidence(rows):
    items = [
        item((i + 1) * 100000, code=row["id"], identifier=str(i)) for i, row in enumerate(rows)
    ]
    return build_evidence(
        {"data": {"dealers": rows}}, {"scope": "owner:test", "items": items}, "owner", 2027
    )


def test_sector_metrics_survive_restricted_resource_amount():
    pcmo = record("D1", sector="PCMO", **{"SP&A": 129569.45})
    pcmo["history"]["resources2025"].pop("MRD")
    pcmo["history"].update(
        yield_value=5.59, vol2025=821370.19, restrictedResources2025=["MRD", "Capex"]
    )
    pcmo["history"]["yield"] = pcmo["history"].pop("yield_value")
    crto = record("D1", sector="CRTO")
    crto["history"].update({"yield": 4.33, "vol2025": 160384.05})
    data = build_evidence(
        {"data": {"dealers": [crto, pcmo]}},
        {"scope": "owner:test", "items": [item(295987.72, sector="PCMO")]},
        "owner",
        2027,
    )
    facts = {f["id"]: f["value"] for f in data["facts"]}
    assert facts["yield:D1"] == 5.59
    assert facts["vol2025:D1"] == 821370.19
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
        {"data": {"dealers": [pcmo]}},
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
    dealer["history"].update({"yield": 5.59, "restrictedResources2025": ["MRD"]})
    data = build_evidence(
        {"data": {"dealers": [dealer]}},
        {"scope": "owner:test", "items": [item(), item(resource="SP&A", identifier="2")]},
        "owner", 2027,
    )
    rows = next(d for d in data["datasets"] if d["id"] == "investment-review")["rows"]
    assert len(rows) == 1 and rows[0]["resource_type"] == "SP&A"
    facts = {f["id"]: f["value"] for f in data["facts"]}
    assert facts["investment-comparison-count"] == facts["investment-review-count"] == 1
    assert facts["allocated"] == 2000000 and facts["yield:D1"] == 5.59


def test_department_permission_skips_resource_even_without_history_rows():
    workspace = {"identity": {"department": ["ICE"]}, "data": {"dealers": []}}
    descriptor = {"scope": "owner:test", "items": [item()]}
    data = build_evidence(workspace, descriptor, "owner", 2027)
    assert not any(f["id"].startswith("investment") for f in data["facts"])
    # Configured multi-department union permits the comparison; source absence
    # then remains genuine missing history rather than being silently skipped.
    workspace["identity"]["department"].append("MKT")
    data = build_evidence(workspace, descriptor, "owner", 2027)
    rows = next(d for d in data["datasets"] if d["id"] == "investment-review")["rows"]
    assert rows[0]["reason_code"] == "missing"
    workspace["identity"]["department"] = ["ICE"]
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
