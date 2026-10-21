"""Deterministic claim/reference guards; never rewrite or approve model prose."""

from __future__ import annotations

import copy
import json
import math
import re
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP


def money_wan(value):
    """Display conversion only; preserve source amounts and calculation precision."""
    scaled = Decimal(str(value).replace(",", "").replace("−", "-")) / Decimal(10000)
    rendered = format(scaled, "f")
    return rendered.rstrip("0").rstrip(".") if "." in rendered else rendered


def format_result_display(result):
    output = copy.deepcopy(result)

    def text(value):
        value = re.sub(r"(?<![A-Za-z\d.])([+\-−]?\d[\d,]*(?:\.\d+)?)\s*(万元|元)",
                       lambda m: (m[1] if m[2] == "万元" else money_wan(m[1])) + "万元", value)
        return re.sub(r"((?:Yield|投入产出比)[^。；;，\n]{0,24}?)([+\-]?\d+(?:\.\d+)?)\s*倍",
                      lambda m: m[1] + str(Decimal(m[2]).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)) + "倍", value, flags=re.I)

    for key in ("headline", "summary"):
        output[key] = text(output[key])
    for collection, keys in (("checks", ("summary",)), ("blocks", ("title", "body"))):
        for item in output[collection]:
            for key in keys:
                item[key] = text(item[key])
    output["limitations"] = [text(value) for value in output["limitations"]]
    return output


def _whole_cohort(text, facts):
    count = facts.get("cohort", {}).get("value")
    return bool(re.search(r"(?:全部|所有|各)(?:已分配)?(?:\d+家)?经销商", text)) or any(
        int(n) == count for n in re.findall(r"(\d+)家经销商", text)
    )


def fact_token_reference(token, facts):
    if token in facts:
        return token, None
    parent, separator, field = token.rpartition(".")
    if (separator and parent.startswith("investment:") and parent in facts
            and field in {"historical_actual", "plan", "delta", "abs_delta", "multiple"}):
        return parent, field
    raise ValueError("unknown_fact_token")


def resolve_fact_tokens(result, evidence):
    """Bind explicit fact tokens; no inferred citations and no rewritten claims."""
    facts = {f["id"]: f for f in evidence["facts"]}
    output = copy.deepcopy(result)
    bindings = []
    token = re.compile(r"\{\{([^{}]+)\}\}")

    def resolve(text, path, refs=None):
        if not isinstance(text, str):
            return text

        def replace(match):
            try:
                key, field = fact_token_reference(match[1], facts)
            except ValueError:
                raise ValueError(f"{path}:unknown_fact_token")
            f = facts[key]
            value = json.loads(f["value"]).get(field) if field else f["value"]
            unit = ("multiple" if field == "multiple" else "CNY") if field else f["unit"]
            wan_suffix = re.match(r"\s*万元", text[match.end():])
            yuan_suffix = re.match(r"\s*元", text[match.end():])
            if value is None:
                rendered = "未提供"
            elif isinstance(value, (int, float)):
                rendered = (
                    money_wan(value) + ("" if wan_suffix else "万元")
                    if unit == "CNY" and not yuan_suffix else
                    f"{value * 100:.2f}".rstrip("0").rstrip(".") + "%"
                    if unit == "ratio"
                    else format(Decimal(str(value)), "f")
                )
                if unit != "ratio" and "." in rendered:
                    rendered = rendered.rstrip("0").rstrip(".")
            else:
                rendered = str(value)
            if refs is not None and key not in refs:
                refs.append(key)
            bindings.append({"path": path, "fact_id": key, **({"field": field} if field else {})})
            return rendered

        return token.sub(replace, text)

    for name in ("headline", "summary"):
        output[name] = resolve(output.get(name), name)
    for collection, fields in [("checks", ["summary"]), ("blocks", ["title", "body"])]:
        for i, item in enumerate(output.get(collection, [])):
            for field in fields:
                item[field] = resolve(
                    item.get(field), f"{collection}.{i}.{field}", item.get("fact_ids")
                )
    output["limitations"] = [
        resolve(t, f"limitations.{i}") for i, t in enumerate(output.get("limitations", []))
    ]
    return output, bindings


def bind_named_facts(result, evidence):
    """Complete citations for explicitly named objects/metrics, then validate claims.

    This changes references only. Wrong numbers, groups, scope or judgments still
    fail the following gate. Every added citation is recorded for inspection.
    """
    output = copy.deepcopy(result)
    facts = {f["id"]: f for f in evidence["facts"]}
    entities = {key.split(":", 1)[1] for key in facts if ":" in key}
    changes = []
    for collection in ("checks", "blocks"):
        for i, item in enumerate(output.get(collection, [])):
            if item.get("dataset_id") is not None:
                continue
            text = item.get("summary", "") + item.get("title", "") + item.get("body", "")
            refs = item.get("fact_ids", [])
            named = {
                e
                for e in entities
                if re.search(r"(?<![A-Za-z0-9_])" + re.escape(e) + r"(?![A-Za-z0-9_])", text)
            }
            all_objects = _whole_cohort(text, facts)

            def add(key, refs=refs, path=f"{collection}.{i}.fact_ids"):
                if key.startswith("yield:") and facts.get(key, {}).get("value") == 0:
                    return
                if key in facts and key not in refs:
                    refs.append(key)
                    changes.append({"path": path, "fact_id": key})

            for entity in named:
                for pattern, prefix in [
                    (r"Yield", "yield"),
                    (r"中位数|分组|象限|高投入|低投入", "position"),
                    (r"计划投入|投入金额", "plan"),
                    (r"占比|占.*分配|份额", "share"),
                ]:
                    if re.search(pattern, text, re.I):
                        add(prefix + ":" + entity)
            for metric, pattern in [("vol", r"Vol|销量"), ("c3", r"C3")]:
                if not re.search(pattern, text, re.I):
                    continue
                for entity in entities if all_objects else named:
                    if re.search(r"变化量|增长量|增量|增长|下降|上升|下滑", text):
                        add(metric + "-change:" + entity)
                    if re.search(r"同比|变化率|增长率", text):
                        add(metric + "-growth:" + entity)
                    if re.search(r"2024|2025", text):
                        for year in (2024, 2025):
                            if str(year) in text:
                                add(f"{metric}{year}:" + entity)
            if re.search(r"\d+\s*项[^。；;]{0,12}(?:复核|确认)|(?:复核|确认)[^。；;\d]{0,8}\d+\s*项", text):
                add("investment-review-count")
            if all_objects:
                add("cohort")
                if re.search(r"Yield", text, re.I):
                    for entity in entities:
                        add("yield:" + entity)
            if re.search(r"(?:各|均|每|所有).*(?:单一|1|一).{0,3}Initiative", text):
                add("max-initiative-count")
            for pattern, key in [
                (r"负责预算|总预算", "budget"),
                (r"已安排", "arranged"),
                (r"差额|金额平衡", "gap"),
                (r"说明.*(?:缺失|完整|已填)", "missing-other-notes"),
            ]:
                if re.search(pattern, text):
                    add(key)
    return output, changes


def compact_evidence(evidence):
    """Lossless tabular transport: retain every row, null, note, scope and year."""
    result = {k: v for k, v in evidence.items() if k not in {"facts", "datasets"}}
    metadata_fields = {"note", "period", "source", "scope_id"}
    fields = [k for k in ("id", "label", "value", "unit") if any(k in f for f in evidence["facts"])]
    fields += sorted({k for f in evidence["facts"] for k in f} - metadata_fields - set(fields))
    result["fact_columns"] = fields
    result["facts"] = [
        [fact.get(key, {"absent": True}) for key in fields] for fact in evidence["facts"]
    ]
    annotations = {}
    for fact in evidence["facts"]:
        details = {k: fact[k] for k in sorted(metadata_fields) if k in fact}
        key = json.dumps(details, ensure_ascii=False, sort_keys=True)
        if key not in annotations:
            annotations[key] = {"fact_ids": [], **details}
        annotations[key]["fact_ids"].append(fact["id"])
    result["fact_annotations"] = list(annotations.values())
    result["datasets"] = []
    for dataset in evidence["datasets"]:
        fields = sorted({key for row in dataset["rows"] for key in row})
        result["datasets"].append(
            {
                **{k: v for k, v in dataset.items() if k != "rows"},
                "row_columns": fields,
                "rows": [
                    [row.get(key, {"absent": True}) for key in fields] for row in dataset["rows"]
                ],
            }
        )
    return {"string_pool": [], "data": result}


def expand_evidence(encoded):
    """Inverse used by regression tests and request inspection, never by the model."""

    def expand(value):
        if isinstance(value, dict):
            if set(value) == {"string_ref"}:
                return encoded["string_pool"][value["string_ref"]]
            return {k: expand(v) for k, v in value.items()}
        if isinstance(value, list):
            return [expand(v) for v in value]
        return value

    result = expand(encoded["data"])

    def rows(values, fields):
        return [
            {k: v for k, v in zip(fields, row, strict=True) if v != {"absent": True}}
            for row in values
        ]

    result["facts"] = rows(result["facts"], result.pop("fact_columns"))
    facts = {f["id"]: f for f in result["facts"]}
    for annotation in result.pop("fact_annotations"):
        for fact_id in annotation["fact_ids"]:
            facts[fact_id].update({k: v for k, v in annotation.items() if k != "fact_ids"})
    for dataset in result["datasets"]:
        dataset["rows"] = rows(dataset["rows"], dataset.pop("row_columns"))
    return result


def compact_schema(schema):
    """Factor repeated schema subtrees into $defs, preserving all constraints."""
    counts = Counter()

    def key(value):
        return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))

    def count(value):
        if isinstance(value, dict):
            counts[key(value)] += 1
            for child in value.values():
                count(child)
        elif isinstance(value, list):
            for child in value:
                count(child)

    count(schema)
    definitions, names = {}, {}

    def fold(value, root=False):
        if isinstance(value, list):
            return [fold(v) for v in value]
        if not isinstance(value, dict):
            return value
        identity = key(value)
        is_schema = any(k in value for k in ("type", "enum", "anyOf", "items"))
        if not root and is_schema and counts[identity] > 1 and len(identity) > 80:
            if identity not in names:
                name = "s" + str(len(names))
                names[identity] = name
                definitions[name] = {k: fold(v) for k, v in value.items()}
            return {"$ref": "#/$defs/" + names[identity]}
        return {k: fold(v) for k, v in value.items()}

    result = fold(schema, True)
    if definitions:
        result["$defs"] = definitions
    return result


def issues(result, evidence):
    """Return precise retry diagnostics without echoing source values or secrets."""
    errors = []
    facts = {f["id"]: f for f in evidence["facts"]}
    datasets = {d["id"]: d for d in evidence["datasets"]}
    constraints = {c["dimension_id"]: c for c in evidence["check_constraints"]}
    review_dims = {d for d, c in constraints.items() if "review" in c["allowed_statuses"]}
    risk = re.compile(
        r"(?:需|应|建议|值得|优先).{0,10}(?:关注|复核|核对|确认|检查)|投入不足|重复激励|资源冲突|配置不合理|错位|背离|反向关系|集中度高|头部集中",
        re.I,
    )
    judgment = re.compile(r"高效|低效|浪费|效率提升|配置合理|投入合理|应增投|应减投")
    negation = re.compile(
        r"不代表|不构成|不等于|不认定|不判断|不能|无法|不作|并非|无须|无需|暂无|未见|未发现|没有|未提供.{0,10}(?:判定|判断)"
    )
    yield_words = re.compile(r"yield|象限", re.I)
    group_words = re.compile(
        r"中位数|象限|高\s*[/／]\s*[高低]|低\s*[/／]\s*[高低]|高于.*分界|低于.*分界"
    )
    trend_words = re.compile(
        r"\bVol\b|\bC3\b|销量|同比|变化率|经营.{0,5}(?:上升|下降|增长|下滑)", re.I
    )
    entities = {key.split(":", 1)[1] for key in facts if ":" in key}
    investment_rows = {}
    for key, fact in facts.items():
        if key.startswith("investment:") and isinstance(fact.get("value"), str):
            try:
                row = json.loads(fact["value"])
                if isinstance(row, dict):
                    investment_rows[key] = row
            except (ValueError, TypeError):
                pass
    entities.update(str(row["dealer_id"]) for row in investment_rows.values() if row.get("dealer_id"))
    aliases = {re.sub(r"\s+", "", e): {e} for e in entities}
    for row in list(investment_rows.values()) + [r for d in datasets.values() for r in d["rows"]]:
        name = row.get("dealer") or row.get("label")
        entity = str(row.get("dealer_id") or row["id"])
        if name and entity in entities:
            aliases.setdefault(re.sub(r"\s+", "", str(name)), set()).add(entity)
    object_names = set(aliases)

    def alias_pattern(name):
        left = r"(?<![A-Za-z0-9_,.])" if name[0].isascii() and name[0].isalnum() else ""
        right = r"(?![A-Za-z0-9_]|[,.]\d)" if name.isdigit() else (r"(?![A-Za-z0-9_])" if name[-1].isascii() and name[-1].isalnum() else "")
        return left + re.escape(name) + right

    def mentions(text):
        normalized = re.sub(r"\s+", "", text)
        found, occupied = [], set()
        for name in sorted(aliases, key=len, reverse=True):
            for match in re.finditer(alias_pattern(name), normalized):
                span = set(range(match.start(), match.end()))
                if not occupied.intersection(span):
                    found.append((match.start(), match.end(), aliases[name]))
                    occupied.update(span)
        return normalized, sorted(found, key=lambda hit: hit[0])

    def belongs_to(fact_id, entity):
        return fact_id.endswith(":" + entity) or investment_rows.get(fact_id, {}).get("dealer_id") == entity

    quadrants = [d for d in datasets.values() if d["kind"] == "quadrant"]

    def numbers(value):
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return [float(value)]
        if isinstance(value, dict):
            if str(value.get("id", "")).startswith("investment:") and isinstance(value.get("value"), str):
                try:
                    row = json.loads(value["value"])
                except (ValueError, TypeError):
                    row = {}
                return numbers(row)
            return [n for v in value.values() for n in numbers(v)]
        if isinstance(value, list):
            return [n for v in value for n in numbers(v)]
        return []

    years = {str(evidence["planning_year"])}
    for item in evidence["facts"] + evidence["datasets"]:
        years.update(re.findall(r"20\d{2}", str(item.get("period", ""))))

    def numeric_claims(text, path, sources):
        values = numbers(sources)
        # Fact notes can carry system-computed boundaries, but never treat arbitrary
        # note numbers as a substitute for the numeric value of a money/ratio fact.
        for source in sources:
            if source.get("id", "").startswith("position:"):
                values.extend(
                    float(n) for n in re.findall(r"\d+(?:\.\d+)?", source.get("note", ""))
                )
        cleaned = re.sub(r"\s+", "", text)
        # Removing spaces joins "Yield 5.6倍" into "Yield5.6倍". The
        # explicit unit identifies a metric, including when a dealer ID happens
        # to be "Yield5.6"; names/IDs without that unit remain entity aliases.
        cleaned = re.sub(r"(?<![A-Za-z0-9_])Yield(?=[+\-−]?\d+(?:\.\d+)?倍)",
                         "指标", cleaned, flags=re.I)
        for entity in sorted(object_names, key=len, reverse=True):
            cleaned = re.sub(alias_pattern(entity), "对象", cleaned)
        cleaned = re.sub(r"C3|Top\d+|SYN\d+", "指标", cleaned, flags=re.I)
        for m in re.finditer(
            r"(?<![A-Za-z\d])([+\-−]?\d[\d,]*(?:\.\d+)?)\s*(万元|万|千|[kK]|[%％])?", cleaned
        ):
            raw = m[1].replace(",", "").replace("−", "-")
            if raw.lstrip("+-") in years:
                continue
            scale = {
                "万元": 10000,
                "万": 10000,
                "千": 1000,
                "k": 1000,
                "K": 1000,
                "%": 0.01,
                "％": 0.01,
            }.get(m[2], 1)
            value = float(raw) * scale
            digits = len(raw.split(".")[1]) if "." in raw else 0
            tolerance = 0.5 * (10**-digits) * scale + 1e-9
            if not any(math.isclose(value, n, abs_tol=tolerance, rel_tol=1e-9) for n in values):
                errors.append(f"{path}:unbound_number:数字须来自关联事实或图表，不能自行补算")
                break

    def ordered_claim(clause, path, referenced):
        """Bind an explicit 'respectively' list in order, never as a value pool."""
        normalized = re.sub(r"\s+", "", clause)
        cohort_prefix = re.match(r"在\d+家(?:计划分配|已分配)?经销商中[，,]", normalized)
        if cohort_prefix:
            normalized = normalized[cohort_prefix.end():]
        normalized, found = mentions(normalized)
        marker = normalized.find("分别")
        if marker < 0:
            return False
        owners, end = [], 0
        separator = re.compile(r"(?:、|和|与|及|以及|，|,)")
        for start, stop, candidates in found:
            if stop > marker or len(candidates) != 1:
                return False
            gap = normalized[end:start]
            if (not owners and gap) or (owners and not separator.fullmatch(gap)):
                return False
            owners.append(next(iter(candidates)))
            end = stop
        if len(owners) < 2 or len(set(owners)) != len(owners) or end != marker:
            return False
        match = re.fullmatch(
            r"分别(?:占经销商分配(?:的比例)?(?:的|为)?|计划投入(?:为|是)?)"
            r"(.+)", normalized[marker:]
        )
        if not match:
            return False
        prefix = "share:" if normalized[marker:].startswith("分别占") else "plan:"
        unit = r"[%％]" if prefix == "share:" else r"(?:万元|元)"
        values = list(re.finditer(r"[+\-−]?\d[\d,]*(?:\.\d+)?" + unit, match[1]))
        if len(values) != len(owners):
            return False
        end = 0
        for index, value in enumerate(values):
            gap = match[1][end:value.start()]
            if (index == 0 and gap) or (index and not separator.fullmatch(gap)):
                return False
            end = value.end()
        if end != len(match[1]):
            return False
        if cohort_prefix:
            numeric_claims(cohort_prefix[0], path,
                           [f for f in referenced if f["id"] == "cohort"])
        for owner, value in zip(owners, values, strict=True):
            numeric_claims(value[0], path,
                           [f for f in referenced if f["id"] == prefix + owner])
        return True

    def check(text, path, refs, dataset_id=None, dimensions=None, status=None):
        # Numbered-list markers are layout, not unbound business quantities.
        # Require a line start and separator whitespace so decimals stay numeric.
        text = re.sub(r"(?m)^[ \t]*\d+[.)、][ \t]+", "", text)
        if re.search(r"其余[^。；;]{0,35}(?:介于|范围|区间)", text):
            errors.append(
                f"{path}:unprovided_aggregate:没有预计算的其余对象范围事实，请列具体对象事实"
            )
        visual_ids = {b.get("dataset_id") for b in result["blocks"] if b.get("dataset_id")}
        if re.search(r"(?:见|参见|参考|详见).{0,5}(?:图表|排序图|象限图)", text) and not visual_ids:
            errors.append(f"{path}:missing_visual:不要引用报告中没有展示的图表")
        if re.search(r"(?:见|参见|参考|详见).{0,5}(?:明细表|历史表)", text) and not any(
            datasets[key]["kind"] == "table" for key in visual_ids if key in datasets
        ):
            errors.append(f"{path}:missing_visual:不要引用报告中没有展示的明细表")
        dataset = datasets.get(dataset_id)
        referenced = [facts[k] for k in refs if k in facts]
        ref_text = " ".join(f["id"] + " " + f["label"] for f in referenced)
        clauses = re.split(r"[。；;！\n]|但|然而", text)
        for clause in clauses:
            absent = re.search(r"(?:无|没有|缺少|缺失|未提供)(?:2025年?)?历史数据", clause)
            if not absent or negation.search(clause[max(0, absent.start() - 8):absent.start()]):
                continue
            _, named = mentions(clause)
            for _, _, owners in named:
                if len(owners) == 1 and any(
                    f["value"] is not None and belongs_to(key, next(iter(owners)))
                    and key.split(":", 1)[0] in {"yield", "vol2024", "vol2025", "c32024", "c32025"}
                    for key, f in facts.items()
                ):
                    errors.append(f"{path}:history_absence_contradiction:该对象已有经营历史；请明确缺失或未授权的具体资源金额，不能称无历史数据")
        permitted = review_dims if dimensions is None else review_dims.intersection(dimensions)
        for clause in clauses:
            # Negation applies only to the following claim, not a later request.
            zero_review_spans = []
            if ("investment-review-count" in refs
                    and facts.get("investment-review-count", {}).get("value") == 0):
                zero_review_spans = [m.span() for m in re.finditer(
                    r"(?<![\d.])0\s*项投入变化(?:需要|需)(?:确认|复核)", clause
                )]
            for pattern, code in [(risk, "unsupported_review"), (judgment, "unsupported_judgment")]:
                for match in pattern.finditer(clause):
                    if pattern is risk and any(
                        start <= match.start() and match.end() <= end
                        for start, end in zero_review_spans
                    ):
                        continue
                    prefix = clause[max(0, match.start() - 12) : match.start()]
                    if negation.search(prefix):
                        continue
                    if not permitted or status in {"observed", "clear", "limited"}:
                        errors.append(f"{path}:{code}:仅陈述事实，不增加复核或效率判断")
                        break
        numeric_claims(text, path, referenced + ([dataset] if dataset else []))
        yield_facts = [f for key, f in facts.items() if key.startswith("yield:")]
        if (yield_facts and len(yield_facts) == facts.get("cohort", {}).get("value")
                and all(f["value"] is not None for f in yield_facts)):
            for clause in re.split(r"[，,。；;！\n]", text):
                # Only the supplied 2025 historical metric is covered. A
                # projected subset, future targets or another year prove no
                # contradiction about missing data outside this population.
                if any(year != "2025" for year in re.findall(r"20\d{2}", clause)):
                    continue
                for missing in re.finditer(
                    r"(?:无|没有|未提供|缺少|缺失)(?:2025(?:年|全年)?)?"
                    r"历史(?:整体)?\s*Yield(?:数据)?", clause, re.I
                ):
                    prefix = clause[max(0, missing.start() - 12):missing.start()]
                    if re.search(r"并非|不是|不代表|不意味着|不能说|未来|目标", prefix):
                        continue
                    errors.append(f"{path}:historical_yield_absence_contradiction:完整范围已有历史Yield，零值不是缺失")
                    break
        if re.search(r"未触发投入变化复核规则", text) and (
            "investment-review-count" not in refs
            or facts.get("investment-review-count", {}).get("value") != 0
        ):
            errors.append(f"{path}:review_count_contradiction:未触发复核须绑定为零的复核项数事实")
        review_counts = re.findall(r"(\d+)\s*项[^。；;]{0,12}(?:复核|确认)|(?:复核|确认)[^。；;\d]{0,8}(\d+)\s*项", text)
        if review_counts and "investment-review-count" in facts:
            expected = facts["investment-review-count"]["value"]
            if any(int(first or second) != expected for first, second in review_counts):
                errors.append(f"{path}:review_count_contradiction:复核项数必须等于系统统计")
        maximum_counts = re.findall(r"Initiative.{0,8}?(?:最大值|最大|最多)[^0-9]{0,5}(\d+)", text, re.I)
        if maximum_counts and "max-initiative-count" in facts:
            if any(int(value) != facts["max-initiative-count"]["value"] for value in maximum_counts):
                errors.append(f"{path}:initiative_count_contradiction:最大项目数必须等于系统统计")
        if _whole_cohort(text, facts) and re.search(r"Yield.{0,8}(?:均为|相同|一致)", text, re.I):
            yields = [f["value"] for key, f in facts.items() if key.startswith("yield:")]
            if not yields or None in yields or len(set(yields)) != 1:
                errors.append(f"{path}:cohort_contradiction:不能把单个对象的Yield推广到全体")
        if re.search(r"(?:各|均|每|所有).*(?:单一|1|一).{0,3}Initiative", text):
            maximum = facts.get("max-initiative-count", {}).get("value")
            if maximum != 1:
                errors.append(f"{path}:overlap_contradiction:并非每个对象都只有一个Initiative")
        # Names and IDs share the same ownership check, including overview text.
        if not dataset:
            for clause in clauses:
                if ordered_claim(clause, path, referenced):
                    continue
                normalized, found = mentions(clause)
                for index, (start, end, owners) in enumerate(found):
                    if len(owners) != 1:
                        errors.append(f"{path}:ambiguous_object:同名对象需明确经销商编号")
                        continue
                    entity = next(iter(owners))
                    sources = [f for f in referenced if belongs_to(f["id"], entity)]
                    if not sources:
                        errors.append(f"{path}:unbound_object:所述对象必须绑定其事实")
                    # Adjacent display name and ID refer to one object; the last
                    # mention checks its following numbers using only that object.
                    stop = found[index + 1][0] if index + 1 < len(found) else len(normalized)
                    segment = normalized[start:stop]
                    # Explicit count phrases bind only their global count, not money.
                    count_keys = set()
                    if re.search(r"\d+家经销商", segment):
                        count_keys.add("cohort")
                    if re.search(r"\d+项[^。；;]{0,12}(?:复核|确认)", segment):
                        count_keys.add("investment-review-count")
                    if re.search(r"Initiative.{0,8}(?:最大|最多)|(?:最大|最多).{0,8}Initiative", segment, re.I):
                        count_keys.add("max-initiative-count")
                    sources += [f for f in referenced if f["id"] in count_keys]
                    # An explicitly named global metric after a comma belongs to
                    # that metric, not to the preceding dealer. Keep unnamed
                    # continuations under the dealer guard to prevent cross-binding.
                    dealer_parts = []
                    for part in re.split(r"[，,](?!\d{3}(?:\D|$))", segment):
                        global_metric = re.fullmatch(
                            r"(负责预算|总预算|已安排金额|预算差额)(?:为|是|共|合计)?"
                            r"[+\-−]?\d[\d,]*(?:\.\d+)?(?:万元|元)", part
                        )
                        if global_metric:
                            key = {"负责预算": "budget", "总预算": "budget",
                                   "已安排金额": "arranged", "预算差额": "gap"}[global_metric[1]]
                            numeric_claims(part, path, [f for f in referenced if f["id"] == key])
                        else:
                            dealer_parts.append(part)
                    numeric_claims("，".join(dealer_parts), path, sources)
        if dimensions is None:
            return
        prefixes = {m[1] for e in entities if (m := re.fullmatch(r"([A-Za-z]+)\d+", e))}
        for prefix in prefixes:
            if any(
                e not in entities
                for e in re.findall(
                    r"(?<![A-Za-z0-9])" + re.escape(prefix) + r"\d+(?![A-Za-z0-9])", text
                )
            ):
                errors.append(f"{path}:unknown_object:不能引入授权证据外的对象")
        if dataset:
            columns = {c["key"] for c in dataset.get("columns", [])}
            has_yield = dataset["kind"] == "quadrant" or any("yield" in k.lower() for k in columns)
            has_trend = any(k.startswith(("vol", "c3")) for k in columns)
            if yield_words.search(text) and not has_yield:
                errors.append(f"{path}:chart_topic_yield:此图不包含Yield；拆成有对应引用的文字块")
            if group_words.search(text) and dataset["kind"] != "quadrant":
                errors.append(
                    f"{path}:chart_topic_group:此图不含象限分界；不要用明细或金额图解释分组"
                )
            if trend_words.search(text) and not has_trend:
                errors.append(f"{path}:chart_topic_trend:此图不包含经营趋势；换对应图或文字块")
        else:
            asserted = re.sub(r"历史(?:整体)?\s*Yield不代表未来(?:回报|收益)", "", text, flags=re.I)
            # A limited check may state that Yield is absent without a numeric
            # citation. Exempt only the exact absence clause, and only when the
            # authorized facts actually contain no known Yield. Other claims,
            # numbers and object references still pass through all normal guards.
            if (status == "limited" and dimensions
                    and all("limited" in constraints[d]["allowed_statuses"] for d in dimensions)
                    and not any(f["value"] is not None for k, f in facts.items()
                                if k.startswith("yield:"))):
                missing_yield = re.compile(
                    r"(?:未提供|缺少|缺失)(?:20\d{2}(?:年|全年)?)?"
                    r"(?:历史)?(?:整体)?\s*(?:Yield|投入产出比)(?:数据)?", re.I
                )
                asserted = "。".join(
                    clause for clause in re.split(r"[。；;！\n]", asserted)
                    if not missing_yield.fullmatch(clause.strip())
                )
            if yield_words.search(asserted) and not re.search(r"yield|position", ref_text, re.I):
                errors.append(f"{path}:missing_yield_reference:绑定具体Yield或position事实")
            if group_words.search(text) and not any(k.startswith("position:") for k in refs):
                errors.append(f"{path}:missing_group_reference:绑定position事实或省略相对分组")
            if trend_words.search(text) and not re.search(r"vol|c3|销量|变化", ref_text, re.I):
                errors.append(f"{path}:missing_trend_reference:绑定具体经营历史或变化事实")
            for metric, mention in [("c3", r"\bC3\b"), ("vol", r"\bVol\b|销量")]:
                if re.search(mention, text, re.I) and not re.search(metric, ref_text, re.I):
                    errors.append(f"{path}:missing_metric_reference:绑定所述具体指标")
        for entity in entities:
            if not re.search(r"(?<![A-Za-z0-9_])" + re.escape(entity) + r"(?![A-Za-z0-9_])", text):
                continue
            if not any(belongs_to(k, entity) for k in refs) and not (
                dataset and any(str(r["id"]) == entity for r in dataset["rows"])
            ):
                errors.append(f"{path}:unbound_object:所述对象必须绑定其事实或图表行")
        # Check relative labels against the system's full-cohort classification.
        for q in quadrants:
            # A single group claim applies to every explicitly named object in
            # the same short clause; mixed groups must use separate clauses.
            for clause in re.split(r"[，,。；;！\n]", text):
                group_claims = re.findall(
                    r"([高低])\s*Yield\s*[/／、 ]*([高低])(?:计划)?投入",
                    clause,
                    re.I,
                )
                if not group_claims:
                    continue
                for row in q["rows"]:
                    if not re.search(
                        r"(?<![A-Za-z0-9_])" + re.escape(str(row["id"])) + r"(?![A-Za-z0-9_])",
                        clause,
                    ):
                        continue
                    expected = (
                        "高"
                        if row["x"] > q["x"]["cutoff"]
                        else "低"
                        if row["x"] < q["x"]["cutoff"]
                        else "边界",
                        "高"
                        if row["y"] > q["y"]["cutoff"]
                        else "低"
                        if row["y"] < q["y"]["cutoff"]
                        else "边界",
                    )
                    if any(tuple(claim) != expected for claim in group_claims):
                        errors.append(
                            f"{path}:group_contradiction:混合分组请逐对象分句，不能概括为同一象限"
                        )
            for row in q["rows"]:
                names = [str(row["id"]), str(row.get("label", ""))]
                for clause in clauses:
                    if not any(
                        n
                        and re.search(
                            r"(?<![A-Za-z0-9_])" + re.escape(n) + r"(?![A-Za-z0-9_])", clause
                        )
                        for n in names
                    ):
                        continue
                    for marker, axis in [(r"(?:历史)?\s*Yield", "x"), (r"计划投入|投入金额", "y")]:
                        match = re.search(
                            "(?:"
                            + marker
                            + r")[^，,；;。]{0,16}?(高于|低于|等于)[^，,；;。]{0,8}(?:中位数|分界)",
                            clause,
                            re.I,
                        )
                        if match:
                            wanted = {"高于": 1, "低于": -1, "等于": 0}[match[1]]
                            actual = (row[axis] > q[axis]["cutoff"]) - (
                                row[axis] < q[axis]["cutoff"]
                            )
                            # Multi-object sentences can be ambiguous; require separate
                            # object statements when their axis groups differ.
                            if wanted != actual:
                                errors.append(
                                    f"{path}:group_contradiction:按给定分组逐对象陈述，不颠倒高低"
                                )

    overview_refs = list(facts)
    # The overview has no citation field; its numbers must match authorized facts.
    check(result["headline"] + "。" + result["summary"], "overview", overview_refs)
    for i, c in enumerate(result["checks"]):
        check(
            c["summary"],
            f"checks.{i}",
            c["fact_ids"],
            dimensions=[c["dimension_id"]],
            status=c["status"],
        )
    for i, b in enumerate(result["blocks"]):
        if b["dataset_id"] in datasets:
            d = datasets[b["dataset_id"]]
            if b["title"] != d["title"] or b["body"].strip():
                errors.append(f"blocks.{i}:system_chart_caption:图表标题和说明由数据集提供")
        check(
            b["title"] + "。" + b["body"],
            f"blocks.{i}",
            b["fact_ids"],
            b["dataset_id"],
            b["dimension_ids"],
            b["status"],
        )
    return list(dict.fromkeys(errors))
