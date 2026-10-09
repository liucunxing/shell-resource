"""Offline behavior checks. Fixtures are authored examples, never model benchmarks."""
from copy import deepcopy
from decimal import Decimal
import io
import json
import re
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import insight_pack as runtime
import build_preview


class PackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack = runtime.InsightPack(ROOT)
        cls.catalog = runtime.load_json(ROOT / "examples/catalog.json")["examples"]

    def sample(self, scene="baseline", preset="comprehensive"):
        item = next(x for x in self.catalog if x["id"] == scene)
        return (runtime.load_json(ROOT / "examples" / item["evidence"]),
                runtime.load_json(ROOT / "examples" / item["results"][preset]))

    def dataset(self, evidence, kind):
        return next(x for x in evidence["datasets"] if x["kind"] == kind)

    def test_all_twelve_results_and_requests(self):
        self.assertEqual(len(self.catalog), 4)
        for item in self.catalog:
            self.assertEqual(len(item["results"]), 3)
            for preset in item["results"]:
                with self.subTest(scene=item["id"], preset=preset):
                    evidence, result = self.sample(item["id"], preset)
                    self.pack.validate_result(result, evidence, preset)
                    payload, meta = self.pack.compile(evidence, preset)
                    self.assertEqual(json.loads(payload["messages"][1]["content"])["evidence"], evidence)
                    self.assertEqual(meta["provenance"]["kind"], "synthetic")

    def test_independent_budget_math_and_declared_share_denominator(self):
        for item in self.catalog:
            evidence, _ = self.sample(item["id"])
            f = {x["id"]: x["value"] for x in evidence["facts"]}
            self.assertEqual(Decimal(str(f["budget"])) - Decimal(str(f["allocated"])) - Decimal(str(f["other"])), Decimal(str(f["gap"])))
            self.assertAlmostEqual(f["top-share"], f["top-plan"] / f["allocated"])
            for d in evidence["datasets"]:
                if d["kind"] == "composition":
                    self.assertEqual(sum(Decimal(str(r["value"])) for r in d["rows"]), Decimal(str(d["denominator"])))
                    self.assertEqual(d["denominator"], f["budget"])
        evidence, _ = self.sample("overspend")
        self.assertFalse(any(d["kind"] == "composition" for d in evidence["datasets"]))
        self.assertGreater(next(x["value"] for x in evidence["facts"] if x["id"] == "arranged-ratio"), 1)

    def test_independent_medians_and_population_counts(self):
        evidence, _ = self.sample()
        d = self.dataset(evidence, "quadrant")
        for axis in ("x", "y"):
            values = sorted(r[axis] for r in d["rows"])
            n = len(values)
            expected = values[n // 2] if n % 2 else (values[n // 2 - 1] + values[n // 2]) / 2
            self.assertEqual(d[axis]["cutoff"], expected)
        self.assertEqual(d["population_count"], len(d["rows"]) + d["excluded_count"])

    def test_missing_is_not_zero_and_not_clear(self):
        evidence, result = self.sample("missing")
        table = self.dataset(evidence, "table")
        self.assertTrue(all(row["yield"] is None for row in table["rows"]))
        self.assertEqual(next(x["value"] for x in evidence["facts"] if x["id"] == "gap"), 0)
        result["checks"][0]["status"] = "clear"
        with self.assertRaises(runtime.PackError):
            self.pack.validate_result(result, evidence)

    def test_duplicate_evidence_ids_and_row_ids(self):
        for target in ("facts", "datasets", "rows"):
            evidence, _ = self.sample()
            rows = evidence[target] if target != "rows" else evidence["datasets"][0]["rows"]
            rows.append(deepcopy(rows[0]))
            with self.subTest(target=target), self.assertRaises(runtime.PackError):
                self.pack.validate_evidence(evidence)

    def test_foreign_scope_and_unknown_evidence_reference(self):
        for change in ("scope_id", "fact_ids"):
            evidence, _ = self.sample()
            evidence["datasets"][0][change] = "foreign-scope" if change == "scope_id" else ["not-authorized-fact"]
            with self.subTest(change=change), self.assertRaises(runtime.PackError):
                self.pack.validate_evidence(evidence)

    def test_unknown_and_malformed_result_fields(self):
        for change in ("unknown", "wrong-type", "missing"):
            evidence, result = self.sample()
            if change == "unknown":
                result["html"] = "<script>untrusted</script>"
            elif change == "wrong-type":
                result["blocks"] = "not-an-array"
            else:
                del result["checks"]
            with self.subTest(change=change), self.assertRaises(runtime.PackError):
                self.pack.validate_result(result, evidence)

    def test_checks_must_cover_six_distinct_dimensions(self):
        evidence, result = self.sample()
        result["checks"][1] = deepcopy(result["checks"][0])
        with self.assertRaises(runtime.PackError):
            self.pack.validate_result(result, evidence)

    def test_required_budget_focus_cannot_disappear_in_any_preset(self):
        for preset in ("comprehensive", "quadrant", "structure"):
            evidence, result = self.sample("overspend", preset)
            result["blocks"] = [b for b in result["blocks"] if "completeness" not in b["dimension_ids"]]
            with self.subTest(preset=preset), self.assertRaises(runtime.PackError):
                self.pack.validate_result(result, evidence)

    def test_required_budget_focus_must_explain_the_issue(self):
        for body in ("", " \n\t"):
            evidence, result = self.sample("overspend", "quadrant")
            for block in result["blocks"]:
                if "completeness" in block["dimension_ids"]:
                    block["body"] = body
            with self.subTest(body=repr(body)), self.assertRaises(runtime.PackError):
                self.pack.validate_result(result, evidence)

    def test_chart_refs_kind_and_preset_are_checked(self):
        for change in ("missing-dataset", "forbidden-kind", "no-dataset", "wrong-preset", "unknown-fact", "duplicate-ref"):
            evidence, result = self.sample("baseline", "quadrant")
            block = result["blocks"][0]
            if change == "missing-dataset": block["dataset_id"] = "invented"
            elif change == "forbidden-kind": block["dataset_id"] = self.dataset(evidence, "composition")["id"]
            elif change == "no-dataset": block["dataset_id"] = None
            elif change == "wrong-preset": result["preset_id"] = "structure"
            elif change == "unknown-fact": block["fact_ids"] = ["invented"]
            else: block["fact_ids"] = ["target", "target"]
            with self.subTest(change=change), self.assertRaises(runtime.PackError):
                self.pack.validate_result(result, evidence, "quadrant")

    def test_overfull_composition_and_invalid_quadrant_are_rejected(self):
        for change in ("overfull", "false-median", "false-count", "missing-coordinate", "flat-axis"):
            evidence, _ = self.sample()
            d = self.dataset(evidence, "composition" if change == "overfull" else "quadrant")
            if change == "overfull": d["rows"][0]["value"] += d["denominator"]
            elif change == "false-median": d["x"]["cutoff"] += 1
            elif change == "false-count": d["population_count"] += 1
            elif change == "missing-coordinate": d["rows"][0]["x"] = None
            else:
                for row in d["rows"]: row["x"] = 1
            with self.subTest(change=change), self.assertRaises(runtime.PackError):
                self.pack.validate_evidence(evidence)

    def test_nonfinite_numbers_rejected(self):
        for value in (float("nan"), float("inf"), float("-inf")):
            evidence, _ = self.sample()
            evidence["facts"][0]["value"] = value
            with self.subTest(value=value), self.assertRaises(runtime.PackError):
                self.pack.validate_evidence(evidence)
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "nan.json"
            p.write_text('{"value":NaN}', encoding="utf-8")
            with self.assertRaises(runtime.PackError): runtime.load_json(p)

    def test_nonfinite_chart_denominator_rejected_in_memory(self):
        # Integrators can pass Python dictionaries without going through JSON parsing.
        for value in (float("nan"), float("inf")):
            evidence, _ = self.sample()
            self.dataset(evidence, "ranked_bar")["denominator"] = value
            with self.subTest(value=value), self.assertRaises(runtime.PackError):
                self.pack.validate_evidence(evidence)

    def test_prompt_edits_reload_same_instance_and_are_preset_local(self):
        evidence, _ = self.sample()
        with tempfile.TemporaryDirectory() as tmp:
            isolated = Path(tmp) / "pack"
            shutil.copytree(ROOT, isolated, ignore=shutil.ignore_patterns("__pycache__", "output", "preview.html"))
            pack = runtime.InsightPack(isolated)
            old, old_meta = pack.compile(evidence, "comprehensive")
            other, other_meta = pack.compile(evidence, "structure")
            prompt_path = pack.path(pack.preset("comprehensive")["prompt"])
            with prompt_path.open("a", encoding="utf-8") as stream:
                stream.write("\n本次测试：请优先从用户决策角度组织解读。\n")
            changed, changed_meta = pack.compile(evidence, "comprehensive")
            other_after, other_after_meta = pack.compile(evidence, "structure")
            self.assertNotEqual(old["messages"][0]["content"], changed["messages"][0]["content"])
            self.assertNotEqual(old_meta["prompt_sha256"], changed_meta["prompt_sha256"])
            self.assertEqual(other, other_after)
            self.assertEqual(other_meta, other_after_meta)
            self.assertEqual(old["response_format"], changed["response_format"])

    def test_prose_and_block_count_are_not_six_paragraph_template(self):
        evidence, result = self.sample()
        result["blocks"][0]["body"] = "依据当前证据补充业务解释。" * 40
        self.assertGreater(len(result["blocks"][0]["body"]), 220)
        extra = deepcopy(result["blocks"][0])
        extra["id"] = "second-independent-interpretation"
        result["blocks"].append(extra)
        self.pack.validate_result(result, evidence)
        evidence, result = self.sample("healthy")
        result["blocks"] = []
        self.pack.validate_result(result, evidence)

    def test_json_object_fallback_and_explicit_model_override(self):
        evidence, _ = self.sample()
        payload, meta = self.pack.compile(evidence, model="test-model", thinking=True, response_format="object")
        self.assertEqual(payload["response_format"], {"type": "json_object"})
        self.assertEqual(payload["model"], "test-model")
        self.assertTrue(meta["thinking"])
        with self.assertRaises(runtime.PackError): self.pack.compile(evidence, response_format="html")

    def imported_preview_data(self, html):
        # Decode the actual embedded data, whether script JSON or a JS assignment.
        decoder = json.JSONDecoder()
        for script in re.findall(r'<script\b[^>]*>(.*?)</script\s*>', html, re.I | re.S):
            for opening in re.finditer(r'\[', script):
                try:
                    value, _ = decoder.raw_decode(script[opening.start():])
                except json.JSONDecodeError:
                    continue
                if isinstance(value, list) and value and isinstance(value[0], dict) and value[0].get("id") == "local-result":
                    return value
        self.fail("Imported preview did not contain a readable local-result dataset")

    def test_imported_raw_and_wrapped_render_only_selected_preset(self):
        evidence, result = self.sample("baseline", "quadrant")
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            ep, rp, output = directory / "evidence.json", directory / "result.json", directory / "preview.html"
            runtime.write_json(ep, evidence)
            for wrapped in (False, True):
                with self.subTest(wrapped=wrapped):
                    supplied = {"metadata": {"model": "offline-test", "prompt_sha256": "local-test"}, "result": result} if wrapped else result
                    runtime.write_json(rp, supplied)
                    with patch.object(runtime.request, "urlopen", side_effect=AssertionError("network forbidden")):
                        build_preview.build_imported(ROOT, ep, rp, output=output)
                    rendered = self.imported_preview_data(output.read_text(encoding="utf-8"))
                    self.assertEqual(len(rendered), 1)
                    self.assertEqual(set(rendered[0]["results"]), {"quadrant"})
                    self.assertEqual(rendered[0]["results"]["quadrant"], result)
                    self.assertEqual(rendered[0]["evidence"], evidence)
                    self.assertEqual(rendered[0]["metadata"], supplied["metadata"] if wrapped else {})

    def test_imported_invalid_preset_or_missing_focus_preserves_old_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            ep, rp, output = directory / "evidence.json", directory / "result.json", directory / "preview.html"
            for failure in ("wrong-preset", "missing-required-focus"):
                with self.subTest(failure=failure):
                    evidence, result = self.sample("overspend", "comprehensive")
                    if failure == "missing-required-focus":
                        result["blocks"] = [b for b in result["blocks"] if "completeness" not in b["dimension_ids"]]
                    runtime.write_json(ep, evidence)
                    runtime.write_json(rp, result)
                    original = b"existing approved preview must survive"
                    output.write_bytes(original)
                    # Builder loads its own runtime module; PackError is still a ValueError.
                    with self.assertRaises(ValueError):
                        build_preview.build_imported(ROOT, ep, rp, preset="structure" if failure == "wrong-preset" else None, output=output)
                    self.assertEqual(output.read_bytes(), original)

    def test_imported_metadata_cannot_override_source_and_script_is_escaped(self):
        evidence, result = self.sample()
        attack = '</script><script id="imported-injection">window.injected=true</script>&\u2028'
        result["headline"] = attack
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            ep, rp, output = directory / "evidence.json", directory / "result.json", directory / "preview.html"
            runtime.write_json(ep, evidence)
            runtime.write_json(rp, {"metadata": {"source_mode": "verified-model", "model": attack}, "result": result})
            build_preview.build_imported(ROOT, ep, rp, output=output)
            html = output.read_text(encoding="utf-8")
            self.assertNotIn('<script id="imported-injection">', html)
            rendered = self.imported_preview_data(html)[0]
            self.assertEqual(rendered["source_mode"], "local")
            self.assertEqual(rendered["evidence"]["provenance"]["kind"], "synthetic")
            self.assertEqual(rendered["results"]["comprehensive"]["headline"], attack)
            self.assertEqual(rendered["metadata"]["model"], attack)

    def test_compile_never_calls_network(self):
        evidence, _ = self.sample()
        with patch.object(runtime.request, "urlopen", side_effect=AssertionError("network forbidden")):
            self.pack.compile(evidence)

    def test_preview_builder_preserves_text_without_script_breakout(self):
        dangerous = '</script><script id="fixture-injection">window.injected=true</script>&\u2028\u2029'
        with tempfile.TemporaryDirectory() as tmp:
            isolated = Path(tmp) / "pack"
            shutil.copytree(ROOT, isolated, ignore=shutil.ignore_patterns("__pycache__", "output", "preview.html"))
            result_path = isolated / "examples" / self.catalog[0]["results"]["comprehensive"]
            result = runtime.load_json(result_path)
            result["headline"] = dangerous
            runtime.write_json(result_path, result)
            generated = build_preview.build(isolated).read_text(encoding="utf-8")
            self.assertNotIn(dangerous, generated)
            self.assertNotIn('<script id="fixture-injection">', generated)
            escaped = json.dumps(dangerous, ensure_ascii=False).replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
            self.assertIn(escaped, generated)

    def test_preview_catalog_cannot_escape_examples_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            isolated = Path(tmp) / "pack"
            shutil.copytree(ROOT, isolated, ignore=shutil.ignore_patterns("__pycache__", "output", "preview.html"))
            catalog_path = isolated / "examples/catalog.json"
            catalog = runtime.load_json(catalog_path)
            catalog["examples"][0]["evidence"] = "../manifest.json"
            runtime.write_json(catalog_path, catalog)
            with self.assertRaises(ValueError): build_preview.build(isolated)

    def test_mock_http_errors_do_not_disclose_credentials_or_response(self):
        secret = "unit-test-only-secret"
        with patch.dict(runtime.os.environ, {"INSIGHT_BASE_URL": "https://example.invalid/v1", "INSIGHT_API_KEY": secret}), patch.object(runtime.request, "urlopen", side_effect=HTTPError("https://example.invalid", 401, secret, {}, io.BytesIO(secret.encode()))):
            with self.assertRaises(runtime.PackError) as caught:
                runtime.call_qwen({"messages": []})
            self.assertNotIn(secret, str(caught.exception))
            self.assertIn("401", str(caught.exception))

    def test_mock_truncated_completion_is_rejected(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, limit):
                return json.dumps({"choices": [{"finish_reason": "length", "message": {"content": "{}"}}]}).encode()
        with patch.dict(runtime.os.environ, {"INSIGHT_BASE_URL": "https://example.invalid/v1", "INSIGHT_API_KEY": "unit-test-token"}), patch.object(runtime.request, "urlopen", return_value=Response()):
            with self.assertRaises(runtime.PackError): runtime.call_qwen({})


if __name__ == "__main__":
    unittest.main(verbosity=2)
