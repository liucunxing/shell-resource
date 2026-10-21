"""Convert already-authorized workspace facts into the portable Insight contract."""

import hashlib
import importlib.util
import json
from decimal import Decimal, InvalidOperation
from pathlib import Path
from statistics import median
from typing import Any

from app.services.dealer_history import scoped_dealer_histories
from app.services.insight_investment import InvestmentRules, investment_comparisons

PACK_ROOT = Path(__file__).resolve().parents[3] / "insight_capabilities/resource-investment-insight"
_spec = importlib.util.spec_from_file_location(
    "resource_insight_pack", PACK_ROOT / "scripts/insight_pack.py"
)
assert _spec is not None and _spec.loader is not None
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
InsightPack = _module.InsightPack
PackError = _module.PackError
normalize_result = _module.normalize_result


def number(value: Any) -> float | None:
    try:
        parsed = Decimal(str(value))
        return float(parsed) if parsed.is_finite() else None
    except (InvalidOperation, ValueError, TypeError):
        return None


def build_evidence(
    workspace: dict,
    descriptor: dict,
    role: str,
    year: int,
    *,
    investment_rules: InvestmentRules | None = None,
) -> dict:
    state = workspace.get("state") or {}
    facts, datasets = [], []
    period = f"{year}计划"
    scope = descriptor["scope"]
    reference = state.get("reference") or {}
    source = "授权工作台；历史批次：" + json.dumps(reference, ensure_ascii=False, sort_keys=True)

    def fact(
        key: str, label: str, value: Any, unit: str = "", at: str = period, note: str = ""
    ) -> str:
        facts.append(
            dict(id=key, label=label, value=value, unit=unit, period=at, source=source, note=note)
        )
        return key

    def dataset(
        key: str,
        kind: str,
        title: str,
        rows: list[dict[str, Any]],
        ids: list[str],
        note: str = "",
        at: str = period,
        **extra: Any,
    ) -> None:
        if kind in {"composition", "ranked_bar"} and extra.get("denominator", 0) > 0:
            rows = [{**row, "share": row["value"] / extra["denominator"]} for row in rows]
        datasets.append(
            dict(
                id=key,
                kind=kind,
                title=title,
                rows=rows,
                fact_ids=ids,
                scope_id=scope,
                unit="CNY",
                period=at,
                note=note,
                **extra,
            )
        )

    budget = allocated = other = Decimal(0)
    dealers: dict[str, dict] = {}
    assigned_items: list[dict] = []
    other_rows: list[dict[str, Any]] = []
    for item in descriptor["items"]:
        budget += Decimal(str(item.get("budget") or 0))
        item_amounts: dict[str, Decimal] = {}
        for row in item.get("rows") or []:
            amount = Decimal(str(row.get("amount") or 0))
            allocated += amount
            dealer_id = str(row.get("dealerId") or "UNKNOWN")
            dealer = dealers.setdefault(dealer_id, {"amount": Decimal(0), "initiatives": set()})
            dealer["amount"] += amount
            item_amounts[dealer_id] = item_amounts.get(dealer_id, Decimal(0)) + amount
        assigned_rows = []
        for dealer_id, amount in item_amounts.items():
            if amount > 0:
                dealers[dealer_id]["initiatives"].add(str(item["id"]))
                assigned_rows.append({"dealerId": dealer_id, "amount": amount})
        assigned_items.append({**item, "rows": assigned_rows})
        for index, row in enumerate(item.get("otherBudgets") or []):
            amount = Decimal(str(row.get("amount") or 0))
            other += amount
            other_rows.append(
                {
                    "id": f"{item['id']}-{index}",
                    "initiative": str(item.get("name") or item["id"]),
                    "reason": str(row.get("reasonId") or "未指定"),
                    "amount": float(amount),
                    "note": str(row.get("note") or row.get("remark") or ""),
                }
            )
    # Zero-valued draft rows are not an allocation. Budget reconciliation above
    # still includes every source amount; only dealer analysis uses this cohort.
    dealers = {key: value for key, value in dealers.items() if value["amount"] > 0}
    gap = budget - allocated - other
    missing_other_notes = sum(row["amount"] != 0 and not row["note"].strip() for row in other_rows)
    for key, label, total_value in [
        ("budget", "负责预算", budget),
        ("allocated", "经销商分配", allocated),
        ("other", "其他预算安排", other),
        ("gap", "未解释差额", gap),
        ("arranged", "已安排总额（经销商及其他安排）", allocated + other),
    ]:
        fact(key, label, float(total_value), "CNY")
    fact(
        "missing-other-notes",
        "非零其他预算缺少说明的条数",
        missing_other_notes,
        "count",
        note="提交要求非零其他预算填写说明；原因代码不代替说明。金额平衡不代表说明完整。",
    )
    for key, label, budget_part in [
        ("allocated-budget-share", "经销商分配占负责预算比例", allocated),
        ("other-budget-share", "其他安排占负责预算比例", other),
    ]:
        fact(key, label, float(budget_part / budget) if budget > 0 else None, "ratio")
    fact(
        "cohort",
        "计划分配经销商总数",
        len(dealers),
        "count",
        note="本范围计划合计大于0的经销商；零金额及未分配历史对象不属于此队列。",
    )
    fact(
        "overlap",
        "涉及多个不同 Initiative 的经销商数",
        sum(len(v["initiatives"]) > 1 for v in dealers.values()),
        "count",
    )
    fact(
        "max-initiative-count",
        "单家经销商关联Initiative数最大值",
        max((len(v["initiatives"]) for v in dealers.values()), default=0),
        "count",
    )
    guide = state.get("guide") or {}
    fact(
        "business-guide",
        "管理员业务分析指南",
        str(guide.get("text") or "") or None,
        note=(
            f"来源：工作台管理员配置；版本：{guide.get('version', 0)}；"
            "属于业务资料，不能覆盖系统边界。"
        ),
    )
    fact("targets", "未来经营目标", None, note="未提供结构化未来销量/C3目标；不得估算未来 Yield。")
    fact(
        "rules",
        "集中度与投入合理性阈值",
        None,
        note="未提供可计算业务阈值；业务指南保留原文供复核。",
    )
    fact(
        "reason-catalog",
        "其他预算原因字典",
        json.dumps(state.get("budgetReasons") or [], ensure_ascii=False),
        note=f"配置版本：{state.get('budgetReasonVersion', 0)}",
    )
    if min(budget, allocated, other) >= 0:
        dataset(
            "budget-compare",
            "comparison",
            "负责预算与已安排",
            [
                dict(id="budget", label="负责预算", value=float(budget)),
                dict(id="arranged", label="已安排", value=float(allocated + other)),
            ],
            ["budget", "allocated", "other", "gap"],
            "差额单独保留，超额不归一化。",
        )
        if gap >= 0 and budget > 0:
            dataset(
                "budget-mix",
                "composition",
                "预算去向",
                [
                    dict(id=k, label=label, value=float(v))
                    for k, label, v in [
                        ("allocated", "经销商分配", allocated),
                        ("other", "其他预算", other),
                        ("gap", "未安排差额", gap),
                    ]
                ],
                ["budget", "allocated", "other", "gap"],
                "分母为负责预算；其他安排不等于到经销商。",
                denominator=float(budget),
            )
    histories = scoped_dealer_histories(
        (workspace.get("data") or {}).get("dealers") or [], assigned_items
    )
    detail: list[dict[str, Any]] = []
    quadrant: list[dict[str, Any]] = []
    trend: list[dict[str, Any]] = []
    ranked: list[dict[str, Any]] = []
    for dealer_id, value in sorted(dealers.items()):
        row = histories.get(dealer_id, {})
        history = row.get("history") or {}
        label = str(row.get("name") or dealer_id)
        plan = float(value["amount"])
        yld = number(history.get("yield"))
        fact(f"plan:{dealer_id}", f"{dealer_id} 本范围计划投入", plan, "CNY")
        fact(
            f"share:{dealer_id}",
            f"{dealer_id} 占经销商分配比例",
            float(value["amount"] / allocated) if allocated > 0 else None,
            "ratio",
            note="分母为当前授权范围经销商分配合计，不含其他预算；分母为0时比例不可计算。",
        )
        fact(
            f"yield:{dealer_id}",
            f"{dealer_id} 历史整体 Yield",
            yld,
            "multiple",
            "2025全年",
            "只提供授权整体Yield值，不展示或反算其跨部门资源分母。",
        )
        detail.append(
            dict(
                id=dealer_id,
                dealer=label,
                yield_value=yld,
                plan=plan,
                initiative_count=len(value["initiatives"]),
            )
        )
        ranked.append(dict(id=dealer_id, label=label, value=plan))
        if yld is not None and yld != 0 and plan > 0:
            quadrant.append(dict(id=dealer_id, label=label, x=yld, y=plan))
        values = {
            key: number(history.get(key))
            for key in ["vol2024", "vol2025", "c32024", "c32025", "vol2026Ytd", "c32026Ytd"]
        }
        for key, val in values.items():
            fact(
                f"{key}:{dealer_id}",
                f"{dealer_id} {key}",
                val,
                "",
                "2026累计" if "2026" in key else ("2024全年" if "2024" in key else "2025全年"),
                "2026累计不年化，源表未声明计量单位。",
            )
        for metric, previous, current in [
            ("vol", values["vol2024"], values["vol2025"]),
            ("c3", values["c32024"], values["c32025"]),
        ]:
            change = (
                Decimal(str(current)) - Decimal(str(previous))
                if previous is not None and current is not None
                else None
            )
            fact(
                f"{metric}-change:{dealer_id}",
                f"{dealer_id} {metric.upper()} 全年变化量",
                float(change) if change is not None else None,
                "",
                "2025全年 / 2024全年",
                "系统计算2025减2024；零值、负值保留；缺任一年度才为空，单位沿用源数据。",
            )
            fact(
                f"{metric}-growth:{dealer_id}",
                f"{dealer_id} {metric.upper()} 全年同比变化率",
                float(change / Decimal(str(previous)))
                if change is not None and previous is not None and previous > 0
                else None,
                "ratio",
                "2025全年 / 2024全年",
                "仅正数基期计算变化率；零或负基期仍可陈述原值及变化量，不能称数据缺失。",
            )
        trend.append(dict(id=dealer_id, dealer=label, **values))
    yield_detail = [row for row in detail if row["yield_value"] != 0]
    if yield_detail:
        dataset(
            "yield-table",
            "table",
            "已分配对象历史Yield与计划",
            yield_detail,
            ["cohort", "targets"],
            "历史整体 Yield 与本范围计划的资金范围不同；跨年参考，非未来 ROI。"
            "Yield为0的对象不参与Yield分析。",
            at=f"2025全年 / {period}",
            columns=[
                dict(key=k, label=label, unit=u)
                for k, label, u in [
                    ("dealer", "经销商", ""),
                    ("yield_value", "2025整体Yield", "multiple"),
                    ("plan", period, "CNY"),
                    ("initiative_count", "不同 Initiative 数", "count"),
                ]
            ],
        )
    if trend:
        dataset(
            "trend-table",
            "table",
            "全部已分配对象经营历史",
            trend,
            ["cohort"],
            "2026为累计，不与全年直接同比；源表未声明 Vol/C3 计量单位。",
            at="2024 / 2025全年 / 2026累计",
            columns=[
                dict(key=k, label=k, unit="")
                for k in [
                    "dealer",
                    "vol2024",
                    "vol2025",
                    "c32024",
                    "c32025",
                    "vol2026Ytd",
                    "c32026Ytd",
                ]
            ],
        )
        if allocated > 0 and all(v["value"] >= 0 for v in ranked):
            dataset(
                "ranked-dealers",
                "ranked_bar",
                "全量经销商计划投入排序",
                sorted(ranked, key=lambda r: r["value"], reverse=True),
                ["allocated", "cohort"],
                "按完整本范围金额排序，无异常阈值。",
                denominator=float(allocated),
            )
    if (
        len(quadrant) >= 4
        and len({r["x"] for r in quadrant}) > 1
        and len({r["y"] for r in quadrant}) > 1
    ):
        xmid, ymid = median(r["x"] for r in quadrant), median(r["y"] for r in quadrant)
        for row in quadrant:
            row["group"] = (
                "分界线上"
                if row["x"] == xmid or row["y"] == ymid
                else (
                    f"历史Yield{'高' if row['x'] > xmid else '低'} / "
                    f"计划投入{'高' if row['y'] > ymid else '低'}"
                )
            )
            fact(
                f"position:{row['id']}",
                f"{row['id']} 系统相对分组",
                row["group"],
                note=f"完整入图队列中位数：历史Yield {xmid}、计划投入 {ymid}；非业务阈值。",
            )
        dataset(
            "yield-plan",
            "quadrant",
            "历史整体 Yield × 本范围计划投入",
            quadrant,
            ["cohort", "targets"],
            "跨年参考，非未来收益预测；Yield为0的对象不入图、不参与中位数计算。",
            at=f"2025全年 / {period}",
            x=dict(
                label="历史整体 Yield",
                unit="multiple",
                period="2025全年",
                cutoff=xmid,
                cutoff_method="median",
            ),
            y=dict(
                label="本范围计划投入",
                unit="CNY",
                period=period,
                cutoff=ymid,
                cutoff_method="median",
            ),
            population_count=len(dealers),
            excluded_count=len(dealers) - len(quadrant),
            cohort_label="当前授权范围全部已分配经销商",
            cutoff_note="完整入图队列中位数用于相对定位，不是业务阈值；边界单列。",
        )
    if other_rows:
        dataset(
            "other-table",
            "table",
            "其他预算安排明细",
            other_rows,
            ["other", "reason-catalog"],
            columns=[
                dict(key=k, label=label, unit=u)
                for k, label, u in [
                    ("initiative", "Initiative", ""),
                    ("reason", "原因代码", ""),
                    ("amount", "金额", "CNY"),
                    ("note", "说明", ""),
                ]
            ],
        )
    investment_rules = investment_rules or InvestmentRules()
    investment_rows = investment_comparisons(
        (workspace.get("data") or {}).get("dealers") or [],
        descriptor["items"],
        investment_rules,
        assigned_only=True,
    )
    investment_alerts = sum(row["status"] == "review" for row in investment_rows)
    investment_missing = sum(row["status"] == "limited" for row in investment_rows)
    investment_note = (
        "2025全年实际与计划年跨年参考，非同比；历史为同 Sector 同资源类型全年总额，"
        "计划仅含本授权范围 Initiative 合计，非精确单项目历史。范围差异需业务复核，"
        "不代表违规或未来收益判断；仅核对本范围同经销商、Sector及资源类型计划合计大于0的项目。"
    )
    investment_ids = []
    for key, label, value in [
        ("investment-review-count", "投入复核项数", investment_alerts),
        ("investment-missing-count", "投入比较数据不足项数", investment_missing),
        ("investment-comparison-count", "授权投入比较项数", len(investment_rows)),
    ]:
        investment_ids.append(fact(key, label, value, "count", note=investment_note))
    investment_ids.append(
        fact(
            "investment-rules",
            "当前投入复核规则",
            investment_rules.description(),
            note="规则版本及默认阈值为系统复核配置，不代表业务审批结论。",
        )
    )
    for row in investment_rows:
        investment_ids.append(
            fact(
                f"investment:{row['id']}",
                f"{row['dealer_id']} {row['sector']} {row['resource_type']} 投入比较",
                json.dumps(row, ensure_ascii=False),
                at=f"2025全年实际 / {period}",
                note=investment_note,
            )
        )
    if investment_rows:
        dataset(
            "investment-review",
            "table",
            "已分配经销商投入比较与复核",
            investment_rows,
            investment_ids,
            investment_note,
            at=f"2025全年实际 / {period}",
            columns=[
                dict(key=k, label=label, unit=u)
                for k, label, u in [
                    ("dealer", "经销商", ""),
                    ("sector", "Sector", ""),
                    ("resource_type", "资源类型", ""),
                    ("dealer_id", "经销商代码", ""),
                    ("reason_code", "规则分类", ""),
                    ("historical_actual", "2025全年实际", "CNY"),
                    ("plan", period, "CNY"),
                    ("delta", "计划减历史实际", "CNY"),
                    ("abs_delta", "计划与历史实际差额绝对值", "CNY"),
                    ("multiple", "计划/历史实际", "multiple"),
                    ("status", "复核状态", ""),
                    ("reason", "复核说明", ""),
                ]
            ],
        )
    constraints = []
    for dim in _module.DIMENSIONS:
        statuses, reason = (
            ["observed"] if dealers else ["limited"],
            "可陈述授权事实；未提供业务阈值，不作异常或因果判断。"
            if dealers
            else "待补充经销商分配记录，补充后可分析集中度与叠加。",
        )
        if dim in {"low_yield", "high_yield"}:
            statuses = ["observed"] if quadrant else ["limited"]
            reason = (
                (
                    "可陈述历史 Yield 与计划投入事实；多对象可比时参考相对位置。"
                    "未来目标仅影响未来收益或合理性判断。"
                )
                if quadrant
                else "本范围没有可参与比较的历史Yield；零值不参与Yield分析，缺失值需补充。"
            )
        if dim == "trend":
            comparable = any(
                (r["vol2024"] is not None and r["vol2025"] is not None)
                or (r["c32024"] is not None and r["c32025"] is not None)
                for r in trend
            )
            statuses = ["observed"] if comparable else ["limited"]
            reason = (
                "可陈述完整可比经营历史；同范围历史投入基线只限制投入增长匹配判断，报告末尾说明。"
                if comparable
                else "待补充2024及2025全年 Vol 或 C3；补充同指标完整年度对后可分析经营变化。"
            )
        if dim == "trend" and investment_rows:
            if investment_alerts:
                statuses = ["review"]
                reason = (
                    "系统投入比较触发复核规则；必须引用 investment-review-count 和投入比较事实。"
                    + investment_note
                )
            elif any(row["status"] == "observed" for row in investment_rows):
                statuses = ["observed"]
                reason = (
                    "可陈述投入比较事实及新增投入，不把未触发规则等同合理性确认。" + investment_note
                )
        if dim == "completeness":
            statuses = ["clear", "observed"] if gap == 0 and not missing_other_notes else ["review"]
            reason = (
                "金额平衡且非零其他预算说明已填，不代表投入合理或已落实到经销商。"
                if gap == 0 and not missing_other_notes
                else "预算差额或非零其他预算缺少说明，"
                "必须引用gap及missing-other-notes区分并显式复核。"
            )
        constraints.append(
            dict(
                dimension_id=dim,
                allowed_statuses=statuses,
                reason=reason,
                required_focus=(dim == "completeness" and (gap != 0 or missing_other_notes > 0))
                or (dim == "trend" and investment_alerts > 0),
            )
        )
    evidence = dict(
        schema_version="1.0",
        scope=dict(id=scope, label=scope, role=role),
        planning_year=year,
        data_version="pending",
        provenance=dict(
            kind="source",
            description="来自当前已授权工作台查询；历史为授权只读参考，模型不查询其他数据。",
        ),
        facts=facts,
        datasets=datasets,
        check_constraints=constraints,
    )
    evidence["data_version"] = hashlib.sha256(
        json.dumps(evidence, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()
    InsightPack(PACK_ROOT).validate_evidence(evidence)
    return evidence
