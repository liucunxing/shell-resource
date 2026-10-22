"""Deterministic comparisons using only the already-authorized workspace reference."""

import hashlib
import json
from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation
from typing import Any


@dataclass(frozen=True)
class InvestmentRules:
    version: str = "investment-review-v1"
    increase_multiple: float = 2.0
    decrease_multiple: float = 0.5
    absolute_change: float = 50000.0

    def __post_init__(self) -> None:
        values = [self.increase_multiple, self.decrease_multiple, self.absolute_change]
        if any(_number(v) is None for v in values):
            raise ValueError("Investment thresholds must be finite")
        if self.increase_multiple <= 1 or not 0 <= self.decrease_multiple < 1:
            raise ValueError("Invalid investment ratio thresholds")
        if self.absolute_change < 0:
            raise ValueError("Investment absolute threshold must be nonnegative")

    def description(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, sort_keys=True)


def _number(value: Any) -> Decimal | None:
    try:
        number = Decimal(str(value))
        return number if number.is_finite() else None
    except (InvalidOperation, TypeError, ValueError):
        return None


def investment_comparisons(
    records: list[dict], items: list[dict], rules: InvestmentRules, *, assigned_only: bool = False
) -> list[dict]:
    """Resource-type baselines are never multiplied by the number of Initiatives.

    Missing Sector cannot establish a like-for-like baseline. Reference records are
    already permission-filtered by the workspace; no new data lookup is performed.
    Assigned-only Insight treats blank drafts as zero and keeps positive totals
    per dealer/Sector/resource, without adding historical-only objects.
    """
    plans: dict[tuple[str, str, str], Decimal | None] = {}
    scope_pairs = set()
    for item in items:
        sector, resource = str(item.get("sector") or ""), str(item.get("resourceType") or "")
        if sector and resource:
            scope_pairs.add((sector, resource))
        for allocation in item.get("rows") or []:
            key = (str(allocation.get("dealerId") or "UNKNOWN"), sector, resource)
            amount = _number(allocation.get("amount"))
            if assigned_only and allocation.get("amount") is None:
                amount = Decimal(0)
            previous = plans.get(key, Decimal(0))
            plans[key] = previous + amount if previous is not None and amount is not None else None
    by_id: dict[str, list[dict]] = {}
    for record in records:
        dealer_id = str(record["id"])
        by_id.setdefault(dealer_id, []).append(record)
        for sector, resource in scope_pairs:
            if not assigned_only and record.get("sector") == sector:
                plans.setdefault((dealer_id, sector, resource), Decimal(0))
    output = []
    for (dealer_id, sector, resource), plan in sorted(plans.items()):
        if assigned_only and (plan is None or plan <= 0):
            continue
        candidates = [r for r in by_id.get(dealer_id, []) if r.get("sector") == sector]
        # A sector-less record alongside an exact record makes the source ambiguous.
        ambiguous = any(not r.get("sector") for r in by_id.get(dealer_id, []))
        record = candidates[0] if len(candidates) == 1 else {}
        baseline = (
            _number(((record.get("history") or {}).get("resources2025") or {}).get(resource))
            if sector and resource and len(candidates) == 1 and not ambiguous
            else None
        )
        delta = plan - baseline if plan is not None and baseline is not None else None
        multiple = (
            plan / baseline if plan is not None and baseline is not None and baseline > 0 else None
        )
        code = "within_threshold"
        status, reason = "observed", "未触发当前投入复核规则；不代表投入合理性已获确认"
        if resource in (record.get("history") or {}).get("restrictedResources2025", []):
            code = "resource_restricted"
            status, reason = (
                "limited",
                f"当前账号无权查看2025年{resource}历史投入金额，无法进行{resource}历史投入对比。"
                "历史整体Yield分析不受此权限限制。",
            )
        elif baseline is None or plan is None or baseline < 0 or plan < 0:
            code = "missing"
            status, reason = (
                "limited",
                "历史或计划缺失、为负或 Sector/资源口径不明确，不能进行可比判断",
            )
        elif baseline > 0 and plan == 0:
            code = "unallocated"
            status, reason = "review", "历史有投入，本范围计划未分配"
        elif baseline == 0 and plan > 0:
            code = "new_investment"
            status, reason = (
                "observed",
                "历史实际为零，本范围新增投入；倍数不可计算",
            )
        elif (
            baseline > 0
            and multiple >= Decimal(str(rules.increase_multiple))
            and delta >= Decimal(str(rules.absolute_change))
        ):
            code = "increase"
            status, reason = "review", "计划较历史实际显著增加，达到倍数及金额复核阈值"
        elif (
            baseline > 0
            and multiple <= Decimal(str(rules.decrease_multiple))
            and -delta >= Decimal(str(rules.absolute_change))
        ):
            code = "decrease"
            status, reason = "review", "计划较历史实际显著减少，达到比例及金额复核阈值"
        token = hashlib.sha256(json.dumps([dealer_id, sector, resource]).encode()).hexdigest()[:20]
        output.append(
            dict(
                id=token,
                dealer=str(record.get("name") or dealer_id),
                dealer_id=dealer_id,
                sector=sector or "未明确",
                resource_type=resource or "未明确",
                historical_actual=float(baseline) if baseline is not None else None,
                plan=float(plan) if plan is not None else None,
                delta=float(delta) if delta is not None else None,
                abs_delta=float(abs(delta)) if delta is not None else None,
                multiple=float(multiple) if multiple is not None else None,
                status=status,
                reason=reason,
                reason_code=code,
            )
        )
    return output
