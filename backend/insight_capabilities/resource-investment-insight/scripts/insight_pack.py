"""Portable request compiler and contract checks. No network unless `call` is used."""
from __future__ import annotations

import argparse
import copy
import hashlib
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

        def check_refs(item):
            if not set(item["fact_ids"]).issubset(facts):
                raise PackError("结果引用了不存在的事实")
            if item["status"] != "limited" and not item["fact_ids"]:
                raise PackError("已观察事实、正常或需关注结论必须引用证据")
            if item["status"] != "limited" and not any(facts[key]["value"] is not None for key in item["fact_ids"]):
                raise PackError("不能仅凭缺失值作出已核对结论")

        for check in checks.values():
            if check["status"] not in constraints[check["dimension_id"]]["allowed_statuses"]:
                raise PackError("六维状态超出宿主证据允许的判断范围")
            check_refs(check)
        for block in result["blocks"]:
            check_refs(block)
            if not any(block["status"] in constraints[key]["allowed_statuses"] for key in block["dimension_ids"]):
                raise PackError("内容块状态不受所关联维度的证据支持")
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
                    raise PackError("必显事项被省略或标记为非关注状态")
        return result

    def compile(self, evidence, preset_id="comprehensive", model=None, thinking=False, response_format="schema"):
        self.validate_evidence(evidence)
        manifest = self.manifest()
        selected = self.preset(preset_id)
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
                {"role": "user", "content": json.dumps({"task": {"preset_id": selected["id"], "preset_version": selected["version"], "output": "JSON", "allowed_visuals": selected["allowed_visuals"]}, "evidence": evidence}, ensure_ascii=False, allow_nan=False)},
            ],
        }
        if response_format == "schema":
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
                check_branches.append(branch)
            api_schema["properties"]["checks"]["items"] = {"anyOf": check_branches}
            block_branches = []
            for status in ("review", "clear", "observed", "limited"):
                dimensions = [constraint["dimension_id"] for constraint in evidence["check_constraints"]
                              if status in constraint["allowed_statuses"]]
                if dimensions:
                    branch = copy.deepcopy(blocks_schema)
                    branch["properties"]["status"]["enum"] = [status]
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
                        properties["fact_ids"]["items"]["enum"] = dataset["fact_ids"]
                        properties["fact_ids"]["minItems"] = 1
                        block_branches.append(visual_branch)
            api_schema["properties"]["blocks"]["items"] = {"anyOf": block_branches}

            payload["response_format"] = {"type": "json_schema", "json_schema": {"name": "resource_investment_insight", "strict": True, "schema": api_schema}}
        elif response_format == "object":
            payload["response_format"] = {"type": "json_object"}
            payload["messages"][0]["content"] += "\n\n返回的 JSON 须符合此结构：\n" + json.dumps(schema, ensure_ascii=False)
        else:
            raise PackError("response_format 只能为 schema 或 object")
        meta = {
            "package_version": manifest["version"], "schema_version": manifest["schema_version"],
            "preset_id": selected["id"], "preset_version": selected["version"],
            "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "schema_sha256": hashlib.sha256(json.dumps(schema, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest(),
            "model": payload["model"], "thinking": bool(thinking), "response_format": response_format,
            "scope_id": evidence["scope"]["id"], "data_version": evidence["data_version"],
            "evidence_sha256": hashlib.sha256(json.dumps(evidence, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")).hexdigest(),
            "provenance": evidence["provenance"],
            "api_schema_projection": "authorized-dataset-title-facts-status-anyOf-omit-uniqueItems",
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
    parser.add_argument("--response-format", choices=["schema", "object"], default="schema")
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
        pack.validate_result(result, evidence, metadata["preset_id"])
        metadata["generated_at"] = datetime.now(timezone.utc).isoformat()
        write_json(args.output, {"metadata": metadata, "usage": usage, "result": result})
        print("PASS: 模型结果通过结构与引用校验；业务解释仍需复核")
        return 0
    except (PackError, OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
