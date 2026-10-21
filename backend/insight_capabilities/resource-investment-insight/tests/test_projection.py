"""Model projections do not replace the full authorized evidence."""
from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from insight_pack import InsightPack, PackError, load_json, _consistency, normalize_result


class ProjectionTests(unittest.TestCase):
    def test_execution_anchor_uses_only_projected_facts_and_keeps_zero_yield(self):
        evidence = self.small_current_with_large_missing_history()
        next(f for f in evidence["facts"] if f["id"] == "yield:current0")["value"] = 0
        evidence["datasets"][1]["rows"][0]["label"] = "匿名完整公司名"
        projected = self.pack.model_evidence(evidence, "quadrant")
        anchor = self.pack.execution_anchor(projected, "quadrant")
        self.assertEqual(anchor["headline_anchor"], "历史投入产出比与计划投入")
        ids = {f["id"] for f in projected["facts"]}
        low = next(c for c in anchor["checks"] if c["dimension_id"] == "low_yield")
        self.assertEqual(low["entity_id"], "current0")
        self.assertEqual(low["entity_name"], "匿名完整公司名")
        self.assertIn("{{yield:current0}}", low["summary"])
        self.assertIn("匿名完整公司名（current0）", low["summary"])
        import re
        for item in [*anchor["checks"], anchor["summary_anchor"]]:
            self.assertTrue(set(item["fact_ids"]).issubset(ids))
            self.assertEqual(set(re.findall(r"\{\{([^{}]+)\}\}", item["summary"])), set(item["fact_ids"]))

    def test_execution_anchor_does_not_override_required_review(self):
        evidence = self.small_current_with_large_missing_history()
        for constraint in evidence["check_constraints"]:
            if constraint["dimension_id"] == "trend":
                constraint.update(allowed_statuses=["review"], required_focus=True)
        anchor = self.pack.execution_anchor(self.pack.model_evidence(evidence), "quadrant")
        self.assertIn("trend", anchor["review_dimensions"])
        self.assertNotIn("trend", [item["dimension_id"] for item in anchor["checks"]])
        self.assertNotIn("summary_anchor", anchor)
        self.assertNotIn("headline_anchor", anchor)

    def test_execution_anchor_missing_yield_is_limited(self):
        evidence = self.small_current_with_large_missing_history()
        for fact in evidence["facts"]:
            if fact["id"].startswith("yield:"):
                fact["value"] = None
        for constraint in evidence["check_constraints"]:
            if constraint["dimension_id"] in {"low_yield", "high_yield"}:
                constraint["allowed_statuses"] = ["limited"]
        anchor = self.pack.execution_anchor(self.pack.model_evidence(evidence), "quadrant")
        low = next(c for c in anchor["checks"] if c["dimension_id"] == "low_yield")
        self.assertEqual(low["status"], "limited")
        self.assertEqual(low["summary"], "未提供历史Yield。")
        self.assertEqual(low["fact_ids"], [])
        result = {"headline": "事实摘要", "summary": "", "checks": [low], "blocks": [], "limitations": []}
        self.assertEqual(_consistency.issues(result, self.pack.model_evidence(evidence)), [])

    def small_current_with_large_missing_history(self):
        evidence = load_json(ROOT / "examples/baseline.evidence.json")
        for constraint in evidence["check_constraints"]:
            constraint.update(allowed_statuses=["observed"], required_focus=False)
        next(f for f in evidence["facts"] if f["id"] == "cohort").update(value=7, unit="count")
        template = deepcopy(evidence["facts"][0])
        quadrant_template = deepcopy(next(d for d in evidence["datasets"] if d["kind"] == "quadrant"))
        quadrant_template["x"].update(cutoff=4, cutoff_method="median")
        quadrant_template["y"].update(cutoff=1003, cutoff_method="median")
        evidence["facts"] = [f for f in evidence["facts"] if ":" not in f["id"]]
        evidence["datasets"] = [d for d in evidence["datasets"] if d["id"] == "budget-mix"]
        rows = []
        for index in range(7):
            entity = f"current{index}"
            rows.append({"id": entity, "label": entity, "x": index + 1, "y": 1000 + index,
                         "group": "synthetic"})
            for metric in ("plan", "yield"):
                evidence["facts"].append({**template, "id": f"{metric}:{entity}", "value": index + 1})
        evidence["datasets"].append({**quadrant_template, "id": "yield-plan", "kind": "quadrant", "title": "Synthetic",
            "scope_id": evidence["scope"]["id"], "unit": "CNY", "period": "2025/2027", "note": "Synthetic",
            "fact_ids": [f["id"] for f in evidence["facts"] if ":" in f["id"]], "rows": rows,
            "population_count": 7, "excluded_count": 0})
        comparisons = []
        for index in range(410):
            row = {"id": f"comparison{index:03}", "dealer_id": f"history{index:03}",
                   "dealer": f"history{index:03}", "status": "limited", "reason_code": "missing",
                   "historical_actual": None, "plan": None, "delta": None}
            comparisons.append(row)
            evidence["facts"].append({**template, "id": "investment:" + row["id"], "value": json.dumps(row)})
        evidence["datasets"].append({"id": "investment-review", "kind": "table", "title": "Synthetic",
            "scope_id": evidence["scope"]["id"], "unit": "CNY", "period": "2025/2027", "note": "Synthetic",
            "fact_ids": ["investment:" + r["id"] for r in comparisons], "rows": comparisons,
            "columns": [{"key": key, "label": key, "unit": ""} for key in comparisons[0] if key != "id"]})
        return evidence

    def test_small_current_cohort_survives_large_missing_history(self):
        evidence = self.small_current_with_large_missing_history()
        before = deepcopy(evidence)
        self.pack.validate_evidence(evidence)
        projected = self.pack.model_evidence(evidence, "quadrant")
        ids = {f["id"] for f in projected["facts"]}
        for index in range(7):
            self.assertIn(f"plan:current{index}", ids)
            self.assertIn(f"yield:current{index}", ids)
        payload, _ = self.pack.compile(evidence, "quadrant")
        sent = json.loads(payload["messages"][1]["content"])["evidence"]["data"]
        quadrant = next(d for d in sent["datasets"] if d["id"] == "yield-plan")
        self.assertEqual(len(quadrant["rows"]), 7)
        self.assertEqual(evidence, before)

    def test_small_cohort_also_keeps_external_review(self):
        evidence = self.small_current_with_large_missing_history()
        row = evidence["datasets"][-1]["rows"][-1]
        row.update(status="review", reason_code="unallocated", delta=-100000)
        projected = self.pack.model_evidence(evidence)
        ids = {f["id"] for f in projected["facts"]}
        self.assertIn("investment:" + row["id"], ids)
        self.assertTrue(all(f"plan:current{i}" in ids for i in range(7)))

    def test_small_dataset_does_not_expose_omitted_entity(self):
        evidence = self.small_current_with_large_missing_history()
        projected = self.pack.model_evidence(evidence, "quadrant")
        projected["facts"] = [f for f in projected["facts"] if not f["id"].endswith(":current6")]
        for dataset in projected["datasets"]:
            dataset["fact_ids"] = [key for key in dataset["fact_ids"] if not key.endswith(":current6")]
        encoded, _ = self.pack.model_transport(evidence, projected)
        sent = next(d for d in encoded["data"]["datasets"] if d["id"] == "yield-plan")
        self.assertEqual(len(sent["rows"]), 6)
        self.assertNotIn("current6", json.dumps(sent["rows"]))
        self.assertEqual(len(evidence["datasets"][1]["rows"]), 7)

    def setUp(self):
        self.pack = InsightPack(ROOT)
        self.evidence = load_json(ROOT / "examples/baseline.evidence.json")
        template = deepcopy(self.evidence["facts"][0])
        rows = []
        for index in range(300):
            token = f"dealer{index:03}"
            row = {"id": token, "dealer": token, "status": "review" if index > 296 else "observed",
                   "reason_code": ["increase", "decrease", "unallocated"][index % 3] if index > 296 else "stable",
                   "delta": index * 1000, "historical_actual": 100000, "plan": 100000 + index * 1000,
                   "multiple": 1 + index / 100}
            rows.append(row)
            self.evidence["facts"].append({**template, "id": "investment:" + token,
                                           "value": json.dumps(row)})
            for metric in ("plan", "yield", "share", "vol2024", "vol2025", "c32024", "c32025", "vol-change", "c3-change", "vol-growth", "c3-growth", "position", "initiative-count"):
                self.evidence["facts"].append({**template, "id": metric + ":" + token, "value": index + 1})
        self.evidence["datasets"].append({"id": "investment-review", "kind": "table", "title": "Investment review",
            "scope_id": self.evidence["scope"]["id"], "unit": "CNY", "period": "2025/2027", "note": "Synthetic",
            "fact_ids": ["investment:" + r["id"] for r in rows], "rows": rows,
            "columns": [{"key": key, "label": key, "unit": ""} for key in rows[0] if key != "id"]})

    def test_large_projection_size_and_late_risk_classes(self):
        before = deepcopy(self.evidence)
        payload, meta = self.pack.compile(self.evidence)
        self.assertLess(len(json.dumps(payload, ensure_ascii=False).encode()), 100000)
        self.assertEqual(self.evidence, before)
        projected = self.pack.model_evidence(self.evidence)
        ids = {f["id"] for f in projected["facts"]}
        for index in (297, 298, 299):
            self.assertIn(f"investment:dealer{index:03}", ids)
        self.assertEqual(len(projected["datasets"][-1]["rows"]), 300)
        self.assertEqual(meta["model_coverage"]["mode"], "representative_projection")
        self.assertGreater(meta["model_coverage"]["omitted_facts"], 3500)
        sent = json.loads(payload["messages"][1]["content"])
        self.assertLessEqual(len(sent["evidence"]["data"]["datasets"][-1]["rows"]), 16)

    def test_investment_json_numbers_bind_without_weakening_numeric_guard(self):
        result = load_json(ROOT / "examples/baseline.comprehensive.json")
        result["blocks"] = [{"id": "investment", "kind": "finding", "title": "投入复核",
                             "body": "计划399000元，历史实际100000元，差额299000元，需复核。",
                             "status": "review", "dimension_ids": ["trend"],
                             "fact_ids": ["investment:dealer299"], "dataset_id": None}]
        errors = _consistency.issues(result, self.evidence)
        self.assertFalse(any("blocks.0" in e and "unbound_number" in e for e in errors), errors)
        result["blocks"][0]["body"] = "计划999999元，需复核。"
        self.assertTrue(any("unbound_number" in e for e in _consistency.issues(result, self.evidence)))

    def test_review_hash_keeps_linked_dealer_operating_facts(self):
        review = self.evidence["datasets"][-1]
        row = review["rows"][120]
        row.update(id="hash120", dealer_id="dealer120", status="review", reason_code="increase", delta=999999)
        review["fact_ids"][120] = "investment:hash120"
        fact = next(f for f in self.evidence["facts"] if f["id"] == "investment:dealer120")
        fact.update(id="investment:hash120", value=json.dumps(row))
        ids = {f["id"] for f in self.pack.model_evidence(self.evidence)["facts"]}
        for key in ("investment:hash120", "plan:dealer120", "yield:dealer120", "vol2025:dealer120", "c32025:dealer120"):
            self.assertIn(key, ids)

    def test_plaintext_omitted_object_rejected_in_overview(self):
        allowed = {f["id"] for f in self.pack.model_evidence(self.evidence)["facts"]}
        missing = next(f["id"] for f in self.evidence["facts"] if f["id"].startswith("plan:") and f["id"] not in allowed)
        with self.assertRaises(PackError):
            self.pack.validate_model_references({"summary": missing.split(":", 1)[1] + "计划200000元"}, self.evidence)

    def test_overview_number_cannot_bind_omitted_fact(self):
        allowed = {f["id"] for f in self.pack.model_evidence(self.evidence)["facts"]}
        missing = next(f for f in self.evidence["facts"] if f["id"].startswith("vol2024:") and f["id"] not in allowed)
        missing["value"] = 987654321
        self.assertNotIn(missing["id"], {f["id"] for f in self.pack.model_evidence(self.evidence)["facts"]})
        result = load_json(ROOT / "examples/baseline.comprehensive.json")
        result["summary"] = "计划987654321元。"
        with self.assertRaisesRegex(PackError, "overview:unbound_number"):
            self.pack.validate_consistency(result, self.evidence)

    def test_hashed_investment_numeric_and_object_binding(self):
        row = {"id": "e46812cea0f8d51ad141", "dealer_id": "SYN001", "dealer": "合成经销商1",
               "historical_actual": 100000, "plan": 1000000, "delta": 900000, "multiple": 10}
        template = self.evidence["facts"][0]
        self.evidence["facts"].append({**template, "id": "investment:" + row["id"], "value": json.dumps(row)})
        result = load_json(ROOT / "examples/baseline.comprehensive.json")
        result["blocks"] = [{"id": "investment", "kind": "finding", "title": "投入复核",
                             "body": "合成经销商1（SYN001）2025实际投入100,000元，2027计划1,000,000元，增加900,000元。请确认增投原因。",
                             "status": "review", "dimension_ids": ["trend"],
                             "fact_ids": ["investment:" + row["id"]], "dataset_id": None}]
        errors = _consistency.issues(result, self.evidence)
        self.assertFalse(any(e.startswith("blocks.0:") for e in errors), errors)
        result["blocks"][0]["body"] = "合成经销商1（SYN001）计划999999元，需复核。"
        self.assertTrue(any(e.startswith("blocks.0:unbound_number") for e in _consistency.issues(result, self.evidence)))

    def test_selected_chinese_name_can_contain_omitted_name(self):
        review = self.evidence["datasets"][-1]
        review["rows"][299]["dealer"] = "成都中润"
        review["rows"][100]["dealer"] = "成都"
        self.pack.validate_model_references({"headline": "成都中润投入变化"}, self.evidence)
        with self.assertRaises(PackError):
            self.pack.validate_model_references({"headline": "成都投入变化"}, self.evidence)

    def test_real_synthetic_model_candidates(self):
        fixture = load_json(ROOT / "tests/fixtures/synthetic_model_replay.json")
        for index, candidate in enumerate(fixture["results"]):
            with self.subTest(candidate=index):
                result, _ = normalize_result(candidate)
                if index == 3:
                    with self.assertRaisesRegex(PackError, "unknown_fact_token"):
                        self.pack.resolve_fact_tokens(result, fixture["evidence"])
                    continue
                result, _ = self.pack.resolve_fact_tokens(result, fixture["evidence"])
                result, _ = self.pack.bind_named_facts(result, fixture["evidence"])
                self.pack.validate_consistency(result, fixture["evidence"])

    def test_display_name_binding_in_blocks_and_overview(self):
        evidence = deepcopy(self.evidence)
        for token, name, amount in [("A", "成都中润", 100000), ("B", "北京经销商", 200000)]:
            evidence["facts"].append({**evidence["facts"][0], "id": "investment:hash" + token,
                "value": json.dumps({"dealer_id": token, "dealer": name, "historical_actual": amount})})
        result = load_json(ROOT / "examples/baseline.comprehensive.json")
        result["blocks"] = [{"id": "named", "kind": "finding", "title": "历史投入",
                            "body": "成都中润2025实际投入200,000元。", "status": "observed",
                            "dimension_ids": ["trend"], "fact_ids": ["investment:hashB"], "dataset_id": None}]
        self.assertTrue(any(e.startswith("blocks.0:unbound_") for e in _consistency.issues(result, evidence)))
        result["headline"] = "成都中润2025实际投入200,000元。"
        self.assertTrue(any(e.startswith("overview:unbound_number") for e in _consistency.issues(result, evidence)))
        result["blocks"][0]["fact_ids"] = ["investment:hashA"]
        result["blocks"][0]["body"] = "成都中润2025实际投入100,000元。"
        result["headline"] = "成都中润2025实际投入100,000元。"
        self.assertFalse(any(e.startswith(("blocks.0:", "overview:")) for e in _consistency.issues(result, evidence)))

    def test_provider_schema_requires_refs_for_nonlimited_status(self):
        evidence = load_json(ROOT / "examples/baseline.evidence.json")
        payload, _ = self.pack.compile(evidence, "structure")
        schema = payload["response_format"]["json_schema"]["schema"]
        def resolve(value):
            while "$ref" in value:
                value = schema["$defs"][value["$ref"].split("/")[-1]]
            return value
        for collection in ("checks", "blocks"):
            items = resolve(resolve(schema["properties"][collection])["items"])
            for branch in items["anyOf"]:
                props = resolve(branch)["properties"]
                if "limited" not in resolve(props["status"])["enum"]:
                    self.assertEqual(resolve(props["fact_ids"])["minItems"], 1)
        result = load_json(ROOT / "examples/baseline.comprehensive.json")
        result["checks"][0]["fact_ids"] = []
        with self.assertRaisesRegex(PackError, "checks.low_yield.fact_ids"):
            self.pack.validate_result(result, evidence)

    def test_review_count_auto_binding_and_wrong_count_rejection(self):
        fixture = load_json(ROOT / "tests/fixtures/synthetic_model_replay.json")
        evidence = fixture["evidence"]
        result, _ = self.pack.resolve_fact_tokens(fixture["results"][0], evidence)
        block = result["blocks"][0]
        block["body"] = "系统触发4项投入复核。"
        block["fact_ids"] = [next(f["id"] for f in evidence["facts"] if f["id"].startswith("investment:"))]
        bound, changes = self.pack.bind_named_facts(result, evidence)
        self.assertIn("investment-review-count", bound["blocks"][0]["fact_ids"])
        self.assertTrue(changes)
        self.pack.validate_consistency(bound, evidence)
        bound["blocks"][0]["body"] = "系统触发3项投入复核。"
        with self.assertRaisesRegex(PackError, "review_count_contradiction"):
            self.pack.validate_consistency(bound, evidence)

    def test_explicit_global_maximum_count_with_dealer_share(self):
        fixture = load_json(ROOT / "tests/fixtures/synthetic_model_replay.json")
        evidence = fixture["evidence"]
        result, _ = self.pack.resolve_fact_tokens(fixture["results"][0], evidence)
        check = next(c for c in result["checks"] if c["dimension_id"] == "concentration")
        check.update(summary="SYN001占经销商分配比例为3.06%，单家关联Initiative数最大值为1。",
                     fact_ids=["share:SYN001", "max-initiative-count"])
        self.pack.validate_consistency(result, evidence)
        check["summary"] = check["summary"].replace("最大值为1", "最大值为2")
        with self.assertRaisesRegex(PackError, "initiative_count_contradiction"):
            self.pack.validate_consistency(result, evidence)

    def test_omitted_reference_and_token_are_rejected(self):
        allowed = {f["id"] for f in self.pack.model_evidence(self.evidence)["facts"]}
        missing = next(f["id"] for f in self.evidence["facts"] if f["id"] not in allowed)
        with self.assertRaises(PackError):
            self.pack.validate_model_references({"checks": [{"fact_ids": [missing]}]}, self.evidence)
        with self.assertRaises(PackError):
            self.pack.validate_model_references({"summary": "{{" + missing + "}}"}, self.evidence)
        self.pack.validate_model_references({"checks": [{"fact_ids": ["investment:dealer299"]}]}, self.evidence)

if __name__ == "__main__":
    unittest.main()
