"""Portable request compiler and contract checks. No network unless `call` is used."""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import statistics
import sys
import tempfile
from datetime import datetime, timezone
from urllib import error, parse, request

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
DIMENSIONS = ("low_yield", "high_yield", "concentration", "overlap", "trend", "completeness")

_consistency_spec = importlib.util.spec_from_file_location(
    "insight_consistency", Path(__file__).with_name("consistency.py")
)
_consistency = importlib.util.module_from_spec(_consistency_spec)
_consistency_spec.loader.exec_module(_consistency)


class PackError(ValueError):
    pass


def reject_constant(value):
    raise PackError(f"JSON 不支持非有限数值：{value}")


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"), parse_constant=reject_constant)


def write_json(path, value):
    """Write only after validation; leave the old file intact on failure."""
    destination = Path(path).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=destination.parent, delete=False) as stream:
            name = stream.name
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
        os.replace(name, destination)
    finally:
        if name and Path(name).exists():
            Path(name).unlink()


def unique_index(rows, key, label):
    index = {row[key]: row for row in rows}
    if len(index) != len(rows):
        raise PackError(f"{label}存在重复 {key}")
    return index


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def reject_nonfinite(value):
    """Also protect Python callers that do not pass through the JSON file loader."""
    if isinstance(value, float) and not math.isfinite(value):
        raise PackError("数据包含非有限数值")
    if isinstance(value, dict):
        for item in value.values():
            reject_nonfinite(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            reject_nonfinite(item)


def normalize_result(result):
    """Deduplicate only set-valued string references, never repair model conclusions."""
    normalized = copy.deepcopy(result)
    changes = []
    if not isinstance(normalized, dict):
        return normalized, changes
    for collection, fields in (("blocks", ("dimension_ids", "fact_ids")), ("checks", ("fact_ids",))):
        rows = normalized.get(collection)
        if not isinstance(rows, list):
            continue
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            for field in fields:
                values = row.get(field)
                if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
                    continue
                unique = list(dict.fromkeys(values))
                if len(unique) != len(values):
                    row[field] = unique
                    changes.append({"path": f"{collection}.{index}.{field}",
                                    "removed_count": len(values) - len(unique)})
    return normalized, changes


class InsightPack:
    def __init__(self, root=ROOT):
        self.root = Path(root).resolve()

    def path(self, relative):
        candidate = (self.root / relative).resolve()
        if not candidate.is_relative_to(self.root):
            raise PackError("能力包资源路径越界")
        return candidate

    def manifest(self):
        return load_json(self.path("manifest.json"))

    def preset(self, preset_id):
        for preset in self.manifest()["presets"]:
            if preset["id"] == preset_id:
                return preset
        raise PackError(f"未知分析方案：{preset_id}")

    def schema(self, name):
        return load_json(self.path(self.manifest()[name]))

    def validate_schema(self, data, name):
        reject_nonfinite(data)
        schema = self.schema(name)
        Draft202012Validator.check_schema(schema)
        errors = sorted(Draft202012Validator(schema).iter_errors(data), key=lambda e: str(list(e.path)))
        if errors:
            first = errors[0]
            # Do not echo evidence values or server response bodies in error output.
            raise PackError(f"{name} 校验失败：{'.'.join(map(str, first.path)) or 'root'} / {first.validator}")

    def validate_evidence(self, evidence):
        self.validate_schema(evidence, "evidence_schema")
        facts = unique_index(evidence["facts"], "id", "事实")
        datasets = unique_index(evidence["datasets"], "id", "图表数据集")
        checks = unique_index(evidence["check_constraints"], "dimension_id", "检查条件")
        if set(checks) != set(DIMENSIONS):
            raise PackError("检查条件必须覆盖六个维度")
        for constraint in checks.values():
            if constraint.get("required_focus") and "review" not in constraint["allowed_statuses"]:
                raise PackError("必显事项与允许状态矛盾")
        for fact in facts.values():
            if isinstance(fact["value"], (int, float)) and not numeric(fact["value"]):
                raise PackError("事实包含非有限数值")
        for dataset in datasets.values():
            if dataset["scope_id"] != evidence["scope"]["id"]:
                raise PackError("图表数据集不属于当前授权范围")
            if not set(dataset["fact_ids"]).issubset(facts):
                raise PackError("图表引用了不存在的事实")
            unique_index(dataset["rows"], "id", "图表数据行")
            kind = dataset["kind"]
            if kind in {"comparison", "composition", "ranked_bar"}:
                if any(not isinstance(row.get("label"), str) or not row["label"] or not numeric(row.get("value")) or row["value"] < 0 for row in dataset["rows"]):
                    raise PackError("金额图表需要明确标签和非负有限数值，缺失不能填零")
                if kind == "composition":
                    total = math.fsum(row["value"] for row in dataset["rows"])
                    if not math.isclose(total, dataset["denominator"], rel_tol=1e-10, abs_tol=0.005):
                        raise PackError("构成图各部分与分母不一致；超额场景应使用金额比较图")
                if kind == "ranked_bar" and dataset.get("denominator") is not None:
                    if math.fsum(row["value"] for row in dataset["rows"]) > dataset["denominator"] + 0.005:
                        raise PackError("排名图金额合计超出声明分母")
            elif kind == "quadrant":
                rows = dataset["rows"]
                if any(not isinstance(row.get("label"), str) or not row["label"] or not numeric(row.get("x")) or not numeric(row.get("y")) or row["y"] < 0 for row in rows):
                    raise PackError("四象限坐标缺失、非有限或计划金额为负")
                if dataset["population_count"] != len(rows) + dataset["excluded_count"]:
                    raise PackError("四象限总体、入图和排除数量不一致")
                for axis in ("x", "y"):
                    values = [row[axis] for row in rows]
                    if len(set(values)) < 2:
                        raise PackError("四象限坐标无差异，应使用明细表")
                    setting = dataset[axis]
                    if not numeric(setting["cutoff"]):
                        raise PackError("四象限分界必须是有限数值")
                    if setting["cutoff_method"] == "median" and not math.isclose(setting["cutoff"], statistics.median(values), rel_tol=1e-10, abs_tol=1e-10):
                        raise PackError("四象限中位数分界与完整入图样本不一致")
            elif kind == "table":
                columns = unique_index(dataset["columns"], "key", "表格列")
                for row in dataset["rows"]:
                    if not set(columns).issubset(row) or not set(row).issubset(set(columns) | {"id"}):
                        raise PackError("表格单元格与列定义不一致")
                    if any(isinstance(value, (int, float)) and not numeric(value) for value in row.values()):
                        raise PackError("表格包含非有限数值")
        return evidence

    def validate_result(self, result, evidence, preset_id=None):
        self.validate_evidence(evidence)
        self.validate_schema(result, "output_schema")
        selected = self.preset(preset_id or result["preset_id"])
        if result["preset_id"] != selected["id"]:
            raise PackError("结果与选定分析方案不一致")
        checks = unique_index(result["checks"], "dimension_id", "六维结果")
        if set(checks) != set(DIMENSIONS):
            raise PackError("六维结果缺失或重复")
        constraints = {row["dimension_id"]: row for row in evidence["check_constraints"]}
        facts = {row["id"]: row for row in evidence["facts"]}
        datasets = {row["id"]: row for row in evidence["datasets"]}
        unique_index(result["blocks"], "id", "内容块")

        def check_refs(item, path):
            if not set(item["fact_ids"]).issubset(facts):
                raise PackError("结果引用了不存在的事实")
            if item["status"] != "limited" and not item["fact_ids"]:
                raise PackError(f"{path}.fact_ids: {item['status']} 必须引用至少一个本次事实ID；请为该结论绑定具体证据")
            if item["status"] != "limited" and not any(facts[key]["value"] is not None for key in item["fact_ids"]):
                raise PackError(f"{path}.fact_ids: 不能仅凭缺失值作出已核对结论；请选择有值的具体事实")

        for check in checks.values():
            if check["status"] not in constraints[check["dimension_id"]]["allowed_statuses"]:
                raise PackError("六维状态超出宿主证据允许的判断范围")
            check_refs(check, "checks." + check["dimension_id"])
        for index, block in enumerate(result["blocks"]):
            check_refs(block, "blocks." + block["id"])
            if not any(block["status"] in constraints[key]["allowed_statuses"] for key in block["dimension_ids"]):
                allowed = sorted({status for key in block["dimension_ids"] for status in constraints[key]["allowed_statuses"]})
                raise PackError(f"blocks.{index}.status: 内容块状态不受所关联维度的证据支持；该块仅允许{allowed}。没有投入比较事实时跳过该部分，不输出权限或历史投入缺失说明，也不能把已有经营趋势降级为limited。")
            dataset_id = block["dataset_id"]
            if block["kind"] == "visual" and dataset_id is None:
                raise PackError("可视化内容块必须引用数据集")
            if dataset_id is not None:
                if dataset_id not in datasets:
                    raise PackError("结果引用了不存在的图表数据集")
                if not set(block["fact_ids"]) & set(datasets[dataset_id]["fact_ids"]):
                    raise PackError("内容块与图表必须至少共享一个关联事实")
                if datasets[dataset_id]["kind"] not in selected["allowed_visuals"]:
                    raise PackError("所选方案未启用此图表类型")
        for dimension, constraint in constraints.items():
            if constraint.get("required_focus"):
                if checks[dimension]["status"] != "review" or not any(block["status"] == "review" and dimension in block["dimension_ids"] and block["body"].strip() for block in result["blocks"]):
                    raise PackError(f"required_focus.{dimension}: 必须提供status=review、包含该维度且body非空的独立finding；不能仅写summary或checks")
        return result

    def validate_consistency(self, result, evidence, preset_id=None):
        self.validate_result(result, evidence, preset_id)
        selected_preset = preset_id or result["preset_id"]
        self.validate_model_references(result, evidence, selected_preset)
        projected = self.model_evidence(evidence, selected_preset)
        problems = _consistency.issues(result, projected)
        if not problems and projected is not evidence:
            problems = _consistency.issues(result, evidence)
        if problems:
            raise PackError("consistency: " + "; ".join(problems[:12]))
        return result

    def resolve_fact_tokens(self, result, evidence):
        self.validate_schema(result, "output_schema")
        try:
            return _consistency.resolve_fact_tokens(result, evidence)
        except ValueError as exc:
            raise PackError(str(exc)) from exc

    def bind_named_facts(self, result, evidence):
        return _consistency.bind_named_facts(result, evidence)

    def unpack_model_result(self, candidate):
        """Move mandatory model-written findings into the stable public blocks API."""
        if not isinstance(candidate, dict):
            raise PackError("模型结果必须为对象")
        result = copy.deepcopy(candidate)
        findings = result.pop("required_findings", {})
        if not isinstance(findings, dict) or not all(isinstance(item, dict) for item in findings.values()):
            raise PackError("required_findings 必须为内容块对象组成的对象")
        blocks = result.get("blocks")
        if not isinstance(blocks, list) or not all(isinstance(item, dict) for item in blocks):
            raise PackError("blocks 必须为内容块对象数组")
        result["blocks"] = list(findings.values()) + blocks
        return result

    def format_result_display(self, result):
        return _consistency.format_result_display(result)

    def model_evidence(self, evidence, preset_id="comprehensive"):
        """Bound model reasoning, while preserving complete server-side chart populations.

        This is a deliberate projection, not a lossless replacement for evidence.
        Dataset rows remain intact here for validation; transport previews are separate.
        """
        selected = self.preset(preset_id)
        excluded_datasets = set(selected.get("excluded_datasets", []))
        zero_yields = {f["id"] for f in evidence["facts"]
                       if f["id"].startswith("yield:") and f["value"] == 0}
        if zero_yields:
            # Keep original zeros in stored evidence, but do not offer them as
            # model examples or authorized Yield citations.
            evidence = copy.deepcopy(evidence)
            evidence["facts"] = [f for f in evidence["facts"] if f["id"] not in zero_yields]
            for dataset in evidence["datasets"]:
                dataset["fact_ids"] = [key for key in dataset["fact_ids"] if key not in zero_yields]
        if len(evidence["facts"]) <= 350:
            if not excluded_datasets:
                return evidence
            return {**evidence, "datasets": [d for d in evidence["datasets"] if d["id"] not in excluded_datasets]}
        entities = []
        comparison_ids = []
        current = list(dict.fromkeys(f["id"].split(":", 1)[1] for f in evidence["facts"]
                                    if f["id"].startswith("plan:")))
        # Reserve up to ten additional review objects for a small current cohort.
        entity_limit = len(current) + 10 if len(current) <= 16 else 16

        def add(entity):
            if entity not in entities and len(entities) < entity_limit:
                entities.append(entity)

        if len(current) <= 16:
            for entity in current:
                add(entity)
        review = next((d for d in evidence["datasets"] if d["id"] == "investment-review"), None)
        ordered = []
        if review:
            ordered = sorted(review["rows"], key=lambda r: (
                r.get("status") != "review", -abs(r.get("delta") or 0), r["id"]))
            classes = set()
            for row in ordered:
                if row.get("status") != "review":
                    continue
                category = (row.get("status"), row.get("reason_code", row.get("reason")))
                if category not in classes:
                    classes.add(category)
                    if len(comparison_ids) < 10:
                        add(row.get("dealer_id", row["id"]))
                        if row.get("dealer_id", row["id"]) in entities:
                            comparison_ids.append(row["id"])
            for row in ordered:
                if len(comparison_ids) >= 10:
                    break
                if row.get("status") == "review" and row["id"] not in comparison_ids:
                    add(row.get("dealer_id", row["id"]))
                    if row.get("dealer_id", row["id"]) in entities:
                        comparison_ids.append(row["id"])
        # Include extrema and each quadrant before filling remaining example slots.
        for prefix in ("plan:", "yield:"):
            values = [f for f in evidence["facts"] if f["id"].startswith(prefix) and numeric(f["value"])]
            if values:
                for fact in (min(values, key=lambda f: f["value"]), max(values, key=lambda f: f["value"])):
                    add(fact["id"].split(":", 1)[1])
        for dataset in evidence["datasets"]:
            if dataset["kind"] == "quadrant":
                groups = set()
                for row in dataset["rows"]:
                    if row.get("group") not in groups:
                        groups.add(row.get("group"))
                        add(row["id"])
        for entity in current:
            add(entity)
        # Missing-history examples must not displace current allocations or risks.
        for row in ordered:
            if len(comparison_ids) >= 10:
                break
            if row["id"] not in comparison_ids:
                add(row.get("dealer_id", row["id"]))
                if row.get("dealer_id", row["id"]) in entities:
                    comparison_ids.append(row["id"])
        for fact in evidence["facts"]:
            if ":" in fact["id"] and not fact["id"].startswith("investment:"):
                add(fact["id"].split(":", 1)[1])
        projected = copy.deepcopy(evidence)
        projected["facts"] = [f for f in projected["facts"]
                              if ":" not in f["id"] or (f["id"].split(":", 1)[1] in comparison_ids
                                  if f["id"].startswith("investment:") else f["id"].split(":", 1)[1] in entities)]
        ids = {f["id"] for f in projected["facts"]}
        projected["datasets"] = [d for d in projected["datasets"]
                                 if d["kind"] in selected["allowed_visuals"] and d["id"] not in excluded_datasets]
        for dataset in projected["datasets"]:
            dataset["fact_ids"] = [key for key in dataset["fact_ids"] if key in ids]
        projected["datasets"] = [d for d in projected["datasets"] if d["fact_ids"]]
        return projected

    def validate_model_references(self, result, evidence, preset_id="comprehensive"):
        projected = self.model_evidence(evidence, preset_id)
        allowed = {f["id"] for f in projected["facts"]}
        allowed_facts = {f["id"]: f for f in projected["facts"]}
        datasets = {d["id"] for d in projected["datasets"]}
        for collection in ("checks", "blocks"):
            for item in result.get(collection, []):
                if not set(item.get("fact_ids", [])).issubset(allowed):
                    raise PackError("模型引用了本次未发送的事实")
                if item.get("dataset_id") is not None and item["dataset_id"] not in datasets:
                    raise PackError("模型引用了本次未发送的数据集")
        # Tokens are resolved later; reject unseen IDs before that stage as well.
        import re
        for token in re.findall(r"\{\{([^{}]+)\}\}", json.dumps(result, ensure_ascii=False)):
            try:
                _consistency.fact_token_reference(token, allowed_facts)
            except ValueError:
                raise PackError("模型占位符引用了本次未发送的事实")
        if projected is not evidence:
            known = {f["id"].split(":", 1)[1] for f in evidence["facts"] if ":" in f["id"]}
            sent = {f["id"].split(":", 1)[1] for f in projected["facts"] if ":" in f["id"]}
            for dataset in evidence["datasets"]:
                for row in dataset["rows"]:
                    if row["id"] in sent or row.get("dealer_id") in sent:
                        name = row.get("dealer") or row.get("label")
                        if name:
                            sent.add(str(name))
            omitted = known - sent
            # Names shown in row labels are also entity identifiers, not permission
            # to discuss a row whose facts were omitted from the model invocation.
            for dataset in evidence["datasets"]:
                for row in dataset["rows"]:
                    if row["id"] in omitted:
                        name = row.get("dealer") or row.get("label")
                        if name and name not in sent:
                            omitted.add(str(name))
            prose = [result.get("headline", ""), result.get("summary", "")]
            prose.extend(result.get("limitations", []))
            for collection in ("checks", "blocks"):
                for item in result.get(collection, []):
                    prose.extend(item.get(key, "") for key in ("title", "body", "summary"))
            text = re.sub(r"\s+", "", "。".join(prose))
            sent = {re.sub(r"\s+", "", name) for name in sent}
            omitted = {re.sub(r"\s+", "", name) for name in omitted} - sent
            # Longest known sent names win, including CJK names with shared prefixes.
            for name in sorted(sent, key=len, reverse=True):
                text = re.sub(r"(?<![A-Za-z0-9_])" + re.escape(name) + r"(?![A-Za-z0-9_])", "【已发送对象】", text)
            for entity in omitted:
                if re.search(r"(?<![A-Za-z0-9_])" + re.escape(entity) + r"(?![A-Za-z0-9_])", text):
                    raise PackError("模型正文提及了本次未发送的对象")
        return result

    def model_transport(self, full, projected):
        transport = copy.deepcopy(projected)
        if {f["id"] for f in projected["facts"]} == {f["id"] for f in full["facts"]}:
            return _consistency.compact_evidence(transport), {"mode": "complete", "total_facts": len(full["facts"]), "selected_facts": len(full["facts"]), "omitted_facts": 0}
        datasets = []
        for dataset in transport["datasets"]:
            total = len(dataset["rows"])
            full_dataset = next(d for d in full["datasets"] if d["id"] == dataset["id"])
            full_row_ids = {key.split(":", 1)[1] for key in full_dataset["fact_ids"] if ":" in key}
            if any(row["id"] in full_row_ids for row in full_dataset["rows"]):
                # A visible row must have a fact the model is permitted to cite,
                # including small datasets within a projected large evidence set.
                row_ids = {key.split(":", 1)[1] for key in dataset["fact_ids"] if ":" in key}
                dataset["rows"] = [r for r in dataset["rows"] if r["id"] in row_ids]
            if total > 16:
                # Only the investment checklist and quadrant need example rows.
                dataset["rows"] = (dataset["rows"][:16]
                                   if dataset["id"] == "investment-review" or dataset["kind"] == "quadrant" else [])
            datasets.append({"id": dataset["id"], "total_rows": total,
                             "selected_rows": len(dataset["rows"]), "omitted_rows": total - len(dataset["rows"]),
                             "render_scope": "complete_authorized_population"})
        coverage = {"mode": "representative_projection", "total_facts": len(full["facts"]),
                    "selected_facts": len(projected["facts"]),
                    "omitted_facts": len(full["facts"]) - len(projected["facts"]),
                    "datasets": datasets,
                    "selection": "complete small current cohort; otherwise review risks, extrema and quadrants, then current allocations; missing-history examples use remaining slots; not a statistical sample"}
        return _consistency.compact_evidence(transport), coverage

    def execution_anchor(self, evidence, preset_id):
        """Give the model safe starting sentences, never generated-result replacements."""
        facts = {fact["id"]: fact for fact in evidence["facts"]}
        names = {}
        for dataset in evidence["datasets"]:
            for row in dataset["rows"]:
                entity = row.get("dealer_id", row["id"])
                name = row.get("dealer") or row.get("label")
                if name and (entity not in names or names[entity] == entity):
                    names[entity] = name

        def token(key):
            return "{{" + key + "}}"

        def name(entity):
            return f"{names.get(entity, entity)}（{entity}）" if names.get(entity, entity) != entity else entity

        def known(key):
            return key in facts and numeric(facts[key]["value"])

        def values(prefix):
            return [fact for key, fact in facts.items() if key.startswith(prefix + ":") and numeric(fact["value"])]

        checks = []
        review_dimensions = []
        for constraint in evidence["check_constraints"]:
            dimension = constraint["dimension_id"]
            statuses = constraint["allowed_statuses"]
            if constraint.get("required_focus") or "review" in statuses:
                review_dimensions.append(dimension)
                continue
            status = "observed" if "observed" in statuses else statuses[0]
            refs, summary, entity = [], "", None
            if dimension in {"low_yield", "high_yield"}:
                candidates = [f for f in values("yield") if known("plan:" + f["id"].split(":", 1)[1])
                              and facts["plan:" + f["id"].split(":", 1)[1]]["value"] > 0]
                if candidates and status != "limited":
                    selected = (min if dimension == "low_yield" else max)(candidates, key=lambda f: f["value"])
                    entity = selected["id"].split(":", 1)[1]
                    refs = [selected["id"], "plan:" + entity]
                    summary = f"{name(entity)}历史Yield为{token(refs[0])}倍，计划投入{token(refs[1])}。"
                elif not values("yield") and "limited" in statuses:
                    status, summary = "limited", "本范围没有可参与比较的历史投入产出比，零值不参与分析。"
            elif dimension == "concentration" and values("share"):
                selected = max(values("share"), key=lambda f: f["value"])
                entity = selected["id"].split(":", 1)[1]
                refs = [selected["id"]]
                summary = f"{name(entity)}占经销商分配的{token(refs[0])}。"
            elif dimension == "trend":
                candidates = values("vol-change") + values("c3-change")
                if candidates and status != "limited":
                    selected = max(candidates, key=lambda f: (
                        known("vol-change:" + f["id"].split(":", 1)[1]) and known("c3-change:" + f["id"].split(":", 1)[1]),
                        abs(f["value"])))
                    entity = selected["id"].split(":", 1)[1]
                    clauses = []
                    for metric, label in (("vol-change", "Vol变化量"), ("c3-change", "C3变化量")):
                        key = metric + ":" + entity
                        if known(key):
                            refs.append(key)
                            clauses.append(label + "为" + token(key))
                    summary = name(entity) + "历史" + "，".join(clauses) + "。"
                elif "limited" in statuses:
                    status, summary = "limited", "缺少可比的完整年度经营数据，需补充后判断变化。"
            elif dimension == "overlap" and known("overlap") and known("max-initiative-count"):
                refs = ["overlap", "max-initiative-count"]
                summary = "在多个项目中获配的经销商有" + token("overlap") + "家，单家经销商最多在" + token("max-initiative-count") + "个项目中获配。"
            elif dimension == "completeness" and all(known(key) for key in ("budget", "arranged", "gap", "missing-other-notes")):
                refs = ["budget", "arranged", "gap", "missing-other-notes"]
                summary = "负责预算" + token("budget") + "，已安排金额" + token("arranged") + "，预算差额" + token("gap") + "。非零其他预算说明缺失数为" + token("missing-other-notes") + "。"
            if summary:
                checks.append({"dimension_id": dimension, "status": status, "summary": summary, "fact_ids": refs,
                               **({"entity_id": entity, "entity_name": names.get(entity, entity)} if entity else {})})
        anchor = {"checks": checks, "review_dimensions": review_dimensions}
        if preset_id == "quadrant" and not review_dimensions:
            anchor["headline_anchor"] = "历史投入产出比与计划投入"
        if preset_id in {"quadrant", "comprehensive"} and not review_dimensions and known("budget") and known("cohort"):
            example = next((item for item in checks if item["dimension_id"] == "low_yield" and item.get("entity_id")), None)
            if example:
                anchor["summary_anchor"] = {
                    "summary": "负责预算" + token("budget") + "，计划分配经销商总数为" + token("cohort") + "。\n" + example["summary"],
                    "fact_ids": ["budget", "cohort", *example["fact_ids"]],
                }
        return anchor

    def compile(self, evidence, preset_id="comprehensive", model=None, thinking=False, response_format=None):
        self.validate_evidence(evidence)
        full_evidence = evidence
        evidence = self.model_evidence(full_evidence, preset_id)
        encoded, coverage = self.model_transport(full_evidence, evidence)
        manifest = self.manifest()
        selected = self.preset(preset_id)
        response_format = response_format or selected.get("response_format", "schema")
        # No prompt cache: edits are read on every invocation, including this same instance.
        common = self.path(manifest["common_prompt"]).read_text(encoding="utf-8-sig")
        method = self.path(selected["prompt"]).read_text(encoding="utf-8-sig")
        if not common.strip() or not method.strip():
            raise PackError("公共或方案提示词为空")
        prompt = common + "\n\n" + method
        schema = self.schema("output_schema")
        payload = {
            "model": model or manifest["default_model"],
            "enable_thinking": bool(thinking),
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": json.dumps({"task": {"preset_id": selected["id"], "preset_version": selected["version"], "output": "JSON", "allowed_visuals": selected["allowed_visuals"]}, "coverage": coverage, "evidence": encoded}, ensure_ascii=False, allow_nan=False, separators=(",", ":"))},
            ],
        }
        focus_dimensions = [c["dimension_id"] for c in evidence["check_constraints"] if c.get("required_focus")]
        task = json.loads(payload["messages"][1]["content"])
        task["task"]["required_focus_dimensions"] = focus_dimensions
        task["task"]["execution_instruction"] = "checks和summary优先以execution_anchor为基础，完整保留对象名称及ID，直接复制标量占位符和精准fact_ids，不自算分组家数、不改写公司名。有headline_anchor时headline直接使用该标题，不自行总结高低或缺失。锚点不替代review维度和required_findings；图表及需复核事项仍按完整任务规则生成。"
        task["task"]["execution_anchor"] = self.execution_anchor(evidence, preset_id)
        display_values = {}
        for fact in evidence["facts"]:
            if fact["unit"] == "CNY" and numeric(fact["value"]):
                display_values[fact["id"]] = _consistency.money_wan(fact["value"]) + "万元"
            elif fact["unit"] == "multiple" and numeric(fact["value"]):
                display_values[fact["id"]] = str(_consistency.Decimal(str(fact["value"])).quantize(_consistency.Decimal("0.1"), rounding=_consistency.ROUND_HALF_UP)) + "倍"
            elif fact["id"].startswith("investment:"):
                row = json.loads(fact["value"])
                display_values[fact["id"]] = {key: (_consistency.money_wan(row[key]) + "万元" if row.get(key) is not None else "缺失") for key in ("historical_actual", "plan", "delta", "abs_delta")}
        task["display_values"] = display_values
        task["task"]["display"] = "金额使用display_values中的万元，Yield保留一位小数；原始值仅用于校验，不能改变判断和分组"
        payload["messages"][1]["content"] = json.dumps(task, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        if response_format in {"schema", "object"}:
            # $schema is for local tooling; the API receives the actual object schema.
            def api_projection(value):
                # Qwen's API schema subset rejects uniqueItems; local validation retains it.
                if isinstance(value, dict):
                    return {key: api_projection(item) for key, item in value.items() if key not in {"$schema", "uniqueItems"}}
                if isinstance(value, list):
                    return [api_projection(item) for item in value]
                return value
            api_schema = api_projection(schema)
            # Bind the provider's decoding schema to this authorized invocation.
            fact_ids = [fact["id"] for fact in evidence["facts"]]
            present_fact_ids = [fact["id"] for fact in evidence["facts"] if fact["value"] is not None]
            dataset_ids = [dataset["id"] for dataset in evidence["datasets"]
                           if dataset["kind"] in selected["allowed_visuals"]]
            checks_schema = api_schema["properties"]["checks"]["items"]
            blocks_schema = api_schema["properties"]["blocks"]["items"]
            for item_schema in (checks_schema, blocks_schema):
                item_schema["properties"]["fact_ids"]["items"]["enum"] = fact_ids
            blocks_schema["properties"]["dataset_id"]["enum"] = dataset_ids + [None]
            check_branches = []
            for constraint in evidence["check_constraints"]:
                branch = copy.deepcopy(checks_schema)
                branch["properties"]["dimension_id"]["enum"] = [constraint["dimension_id"]]
                branch["properties"]["status"]["enum"] = constraint["allowed_statuses"]
                if "limited" not in constraint["allowed_statuses"]:
                    branch["properties"]["fact_ids"]["minItems"] = 1
                    branch["properties"]["fact_ids"]["items"]["enum"] = present_fact_ids
                check_branches.append(branch)
            api_schema["properties"]["checks"]["items"] = {"anyOf": check_branches}
            block_branches = []
            for status in ("review", "clear", "observed", "limited"):
                dimensions = [constraint["dimension_id"] for constraint in evidence["check_constraints"]
                              if status in constraint["allowed_statuses"]]
                if dimensions:
                    branch = copy.deepcopy(blocks_schema)
                    branch["properties"]["status"]["enum"] = [status]
                    if status != "limited":
                        branch["properties"]["fact_ids"]["minItems"] = 1
                        branch["properties"]["fact_ids"]["items"]["enum"] = present_fact_ids
                    branch["properties"]["dimension_ids"]["items"]["enum"] = dimensions
                    branch["properties"]["dimension_ids"]["maxItems"] = min(6, len(dimensions))
                    text_branch = copy.deepcopy(branch)
                    text_branch["properties"]["kind"]["enum"] = ["finding", "note"]
                    text_branch["properties"]["dataset_id"]["enum"] = [None]
                    block_branches.append(text_branch)
                    for dataset in evidence["datasets"]:
                        if dataset["id"] not in dataset_ids:
                            continue
                        visual_branch = copy.deepcopy(branch)
                        properties = visual_branch["properties"]
                        properties["kind"]["enum"] = ["visual"]
                        properties["dataset_id"]["enum"] = [dataset["id"]]
                        properties["title"]["enum"] = [dataset["title"]]
                        # Graph captions already come from the verified dataset.
                        # Any AI interpretation must be a separately grounded finding.
                        properties["body"]["enum"] = [""]
                        properties["fact_ids"]["items"]["enum"] = [key for key in dataset["fact_ids"] if status == "limited" or key in present_fact_ids]
                        properties["fact_ids"]["minItems"] = 1
                        block_branches.append(visual_branch)
            api_schema["properties"]["blocks"]["items"] = {"anyOf": block_branches}
            if focus_dimensions:
                # A required object key is enforced by provider decoding. An optional
                # blocks array plus a prose instruction allowed blocks=[] repeatedly.
                required_findings = {"type": "object", "properties": {}, "required": focus_dimensions, "additionalProperties": False}
                for dimension in focus_dimensions:
                    finding = copy.deepcopy(blocks_schema)
                    props = finding["properties"]
                    props["id"]["enum"] = ["focus-" + dimension]
                    props["kind"]["enum"] = ["finding"]
                    props["status"]["enum"] = ["review"]
                    props["dimension_ids"].update(items={"type": "string", "enum": [dimension]}, minItems=1, maxItems=1)
                    props["dataset_id"]["enum"] = [None]
                    props["body"]["minLength"] = 1
                    props["fact_ids"]["minItems"] = 1
                    props["fact_ids"]["items"]["enum"] = present_fact_ids
                    required_findings["properties"][dimension] = finding
                api_schema["properties"]["required_findings"] = required_findings
                api_schema["required"].append("required_findings")
                api_schema["properties"]["blocks"]["maxItems"] = max(0, api_schema["properties"]["blocks"].get("maxItems", 12) - len(focus_dimensions))

            wire_schema = _consistency.compact_schema(api_schema)
            if response_format == "schema":
                payload["response_format"] = {"type": "json_schema", "json_schema": {"name": "resource_investment_insight", "strict": True, "schema": wire_schema}}
            else:
                # Qwen's constrained decoder repeatedly aborts on quadrant output.
                # Keep the same authorized wire contract; host validation is mandatory.
                payload["response_format"] = {"type": "json_object"}
                payload["stream"] = False
                payload["messages"][0]["content"] += "\n\n返回的 JSON 须符合此结构：\n" + json.dumps(wire_schema, ensure_ascii=False, separators=(",", ":"))
        else:
            raise PackError("response_format 只能为 schema 或 object")
        meta = {
            "package_version": manifest["version"], "schema_version": manifest["schema_version"],
            "preset_id": selected["id"], "preset_version": selected["version"],
            "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "schema_sha256": hashlib.sha256(json.dumps(schema, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest(),
            "model": payload["model"], "thinking": bool(thinking), "response_format": response_format,
            "scope_id": evidence["scope"]["id"], "data_version": evidence["data_version"],
            "evidence_sha256": hashlib.sha256(json.dumps(full_evidence, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")).hexdigest(),
            "provenance": evidence["provenance"],
            "api_schema_projection": "authorized-anyOf-required-focus-v3",
            "input_encoding": "bounded-columnar-projection-v4",
            "model_coverage": coverage,
            "consistency_version": "1.0",
            "consistency_sha256": hashlib.sha256(Path(__file__).with_name("consistency.py").read_bytes()).hexdigest(),
        }
        return payload, meta


def call_qwen(payload, timeout=120):
    """Explicit opt-in only. Never reads another project's settings or prints credentials."""
    base = os.environ.get("INSIGHT_BASE_URL", "").rstrip("/")
    token = os.environ.get("INSIGHT_API_KEY", "")
    if not base or not token:
        raise PackError("真实调用需要环境变量 INSIGHT_BASE_URL 和 INSIGHT_API_KEY")
    parsed = parse.urlparse(base)
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise PackError("模型地址不应包含凭据、查询参数或片段")
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}):
        raise PackError("模型地址需要 HTTPS，本机测试端点除外")
    endpoint = base if base.endswith("/chat/completions") else base + "/chat/completions"
    req = request.Request(endpoint, data=json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8"), headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}, method="POST")
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read(16 * 1024 * 1024 + 1)
        if len(raw) > 16 * 1024 * 1024:
            raise PackError("模型响应超过本地读取上限")
        envelope = json.loads(raw, parse_constant=reject_constant)
        choice = envelope["choices"][0]
        if choice.get("finish_reason") not in {None, "stop"}:
            raise PackError("模型未完整返回结果，旧结果不会被覆盖")
        content = choice["message"]["content"]
        if not isinstance(content, str):
            raise PackError("模型 content 不是 JSON 文本")
        return json.loads(content, parse_constant=reject_constant), envelope.get("usage", {})
    except error.HTTPError as exc:
        raise PackError(f"模型 HTTP 错误 {exc.code}；未记录响应正文或请求凭据") from None
    except (error.URLError, TimeoutError, KeyError, IndexError, TypeError, json.JSONDecodeError):
        raise PackError("模型连接或返回格式异常，旧结果不会被覆盖") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["request", "check", "call"])
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--preset", choices=["comprehensive", "quadrant", "structure"])
    parser.add_argument("--result")
    parser.add_argument("--output")
    parser.add_argument("--model", default=os.environ.get("INSIGHT_MODEL"))
    parser.add_argument("--thinking", action="store_true")
    parser.add_argument("--response-format", choices=["schema", "object"], default=None)
    args = parser.parse_args()
    pack = InsightPack()
    try:
        evidence = load_json(args.evidence)
        if args.command == "check":
            pack.validate_evidence(evidence)
            if args.result:
                result = load_json(args.result)
                pack.validate_result(result.get("result", result) if isinstance(result, dict) else result, evidence, args.preset)
            print("PASS: evidence" + (" + result" if args.result else ""))
            return 0
        if not args.output:
            raise PackError("request/call 需要 --output 指定本地输出文件")
        payload, metadata = pack.compile(evidence, args.preset or "comprehensive", args.model, args.thinking, args.response_format)
        if args.command == "request":
            write_json(args.output, {"metadata": metadata, "request": payload})
            print("PASS: 请求已生成，未联网")
            return 0
        result, usage = call_qwen(payload)
        result, metadata["normalizations"] = normalize_result(pack.unpack_model_result(result))
        result, metadata["fact_bindings"] = pack.resolve_fact_tokens(result, evidence)
        result, metadata["citation_bindings"] = pack.bind_named_facts(result, evidence)
        pack.validate_consistency(result, evidence, metadata["preset_id"])
        result = pack.format_result_display(result)
        metadata["generated_at"] = datetime.now(timezone.utc).isoformat()
        write_json(args.output, {"metadata": metadata, "usage": usage, "result": result})
        print("PASS: 模型结果通过结构与引用校验；业务解释仍需复核")
        return 0
    except (PackError, OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
