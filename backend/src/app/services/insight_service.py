"""Small, evidence-led integration with BaiLian's OpenAI-compatible API."""

import hashlib
import json
from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, NoReturn, cast

import httpx
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.insight import InsightPromptDO, InsightRecordDO
from app.repositories.insight_repository import InsightRepository
from app.services.insight_pack_adapter import (
    PACK_ROOT,
    InsightPack,
    PackError,
    build_evidence,
    normalize_result,
)

DEFAULT_PROMPT = (
    "按六点分别说明事实、复核方向：低 Yield 与投入、高 Yield 与投入、集中度、"
    "多 Initiative 叠加、Vol/C3 趋势、预算完整性。只使用给定证据，不推断因果。"
)
ITEM_KEYS = ("low_yield", "high_yield", "concentration", "overlap", "trend", "completeness")


class InsightService:
    def __init__(
        self,
        session: AsyncSession,
        user: WorkbenchUser,
        settings: Settings,
        repository: InsightRepository | None = None,
    ) -> None:
        self.session = session
        self.user = user
        self.settings = settings
        self.repository = repository or InsightRepository(session)

    async def get_insight(
        self, *, scope: str, planning_year: int, preset_id: str = "comprehensive"
    ) -> dict[str, Any]:
        self._preset(preset_id)
        workspace = await self._workspace(planning_year)
        descriptor = self._scope(workspace, scope)
        self._assert_read(descriptor)
        prompt = await self._prompt(planning_year, scope, descriptor)
        record: dict[str, Any] | None
        if self.user.role == "management":
            evidence, _ = self._evidence(workspace, descriptor)
            record = self._record(
                scope,
                self._signature(workspace, scope, prompt, preset_id),
                prompt,
                workspace,
                evidence,
                "各项最新同步快照",
                {key: "请结合以上已同步事实复核；此处为只读计算预览。" for key in ITEM_KEYS},
            )
            record["status"] = "preview"
            record["disclaimer"] = (
                "根据最新同步快照与当前授权历史参考计算；未调用 AI，不含未同步草稿。"
            )
            return {
                "record": record,
                "prompt": self._prompt_vo(prompt, descriptor),
                "presets": self.presets(),
                "presetId": preset_id,
            }
        record = None
        saved = await self.repository.latest_record(
            planning_year, scope, self.user.email, preset_id
        )
        if saved and saved.record.get("access") == self._access(descriptor):
            record = dict(saved.record)
            record["stale"] = record.get("signature") != self._signature(
                workspace, scope, prompt, preset_id
            )
        return {
            "record": record,
            "prompt": self._prompt_vo(prompt, descriptor),
            "presets": self.presets(),
            "presetId": preset_id,
        }

    async def update_prompt(
        self, *, scope: str, planning_year: int, text: str, expected_version: int
    ) -> dict[str, Any]:
        workspace = await self._workspace(planning_year)
        descriptor = self._scope(workspace, scope)
        self._assert_prompt_edit(descriptor)

    async def generate(
        self, *, scope: str, planning_year: int, preset_id: str = "comprehensive"
    ) -> dict[str, Any]:
        self._preset(preset_id)
        workspace = await self._workspace(planning_year)
        descriptor = self._scope(workspace, scope)
        self._assert_generate(descriptor)
        prompt = await self._prompt(planning_year, scope, descriptor)
        signature = self._signature(workspace, scope, prompt, preset_id)
        access = self._access(descriptor)
        evidence = build_evidence(workspace, descriptor, self.user.role, planning_year)
        pack = InsightPack(PACK_ROOT)
        body, metadata = pack.compile(
            evidence, preset_id, model=self.settings.ai_model, thinking=False
        )
        await self._finish_read_transaction()
        candidate, usage = await self._call_model(body)
        result, normalizations = normalize_result(candidate)
        try:
            pack.validate_result(result, evidence, preset_id)
        except PackError as exc:
            raise HTTPException(
                status_code=502, detail="百炼 Insight 结果校验失败，原记录已保留"
            ) from exc
        await self._refresh_user()
        current_workspace = await self._workspace(planning_year)
        current_descriptor = self._scope(current_workspace, scope)
        self._assert_generate(current_descriptor)
        if self._access(current_descriptor) != access:
            raise HTTPException(status_code=409, detail="生成期间授权范围已变化，请重新生成")
        current_prompt = await self._prompt(planning_year, scope, current_descriptor)
        guide = workspace["state"].get("guide") or {}
        record = {
            "scope": scope,
            "status": "generated",
            "signature": signature,
            "analysisMethodVersion": metadata["package_version"],
            "reference": self._reference(workspace),
            "guideVersion": int(guide.get("version") or 0),
            "createdAt": datetime.now(UTC).isoformat(),
            "basisLabel": "当前授权工作稿",
            "guideText": str(guide.get("text") or ""),
            "promptText": "",
            "promptVersion": 0,
            "promptScope": scope,
            "presetId": preset_id,
            "result": result,
            "evidence": evidence,
            "metadata": {
                **metadata,
                "usage": usage,
                "normalizations": normalizations,
                "guide_version": int(guide.get("version") or 0),
            },
            "items": [],
            "access": access,
            "disclaimer": "AI 仅解释后端已授权事实；不修改预算、不作因果推断。",
            "stale": signature
            != self._signature(current_workspace, scope, current_prompt, preset_id),
        }
        await self._finish_read_transaction()

        async with self.session.begin():
            saved = InsightRecordDO(
                planning_year=planning_year,
                scope=scope,
                signature=signature,
                prompt_version=prompt.version,
                reference_batch_id=self._reference(workspace).get("batchId") or None,
                guide_version=int((workspace["state"].get("guide") or {}).get("version") or 0),
                created_by_email=str(getattr(self.user, "email", "")),
                record=record,
            )
            await self.repository.add_record(saved)
        return record

    async def _refresh_user(self) -> None:
        # Permissions may be revoked while the remote request is running.
        from app.dependencies.workbench_user import get_current_workbench_user

        self.session.expire_all()
        self.user = await get_current_workbench_user(self.session, x_user_email=self.user.email)

    async def _workspace(self, planning_year: int) -> dict[str, Any]:
        # Imported here so the Insight module remains independently testable while
        # the workbench service is assembled by the backend owner.
        from app.services.workspace_service import WorkspaceService

        return await WorkspaceService(self.session, self.user).get_workspace(planning_year)

    async def _prompt(
        self, planning_year: int, scope: str, descriptor: dict[str, Any]
    ) -> InsightPromptDO:
        prompt = await self.repository.get_prompt(planning_year, scope)
        if prompt is not None:
            return prompt
        return InsightPromptDO(
            planning_year=planning_year, scope=scope, text=DEFAULT_PROMPT, version=0
        )

    async def _finish_read_transaction(self) -> None:
        if self.session.in_transaction():
            await self.session.commit()

    def _scope(self, workspace: dict[str, Any], scope: str) -> dict[str, Any]:
        state = workspace.get("state") or {}
        items = list(state.get("initiatives") or [])
        role = str(getattr(self.user, "role", ""))
        email = str(getattr(self.user, "email", ""))
        department = getattr(self.user, "department", None)
        if scope == "global":
            return {"kind": "global", "scope": scope, "items": items}
        if scope.startswith("initiative:"):
            item_id = scope.split(":", 1)[1]
            scoped = [item for item in items if str(item.get("id")) == item_id]
            if not scoped:
                raise HTTPException(status_code=404, detail="Insight Initiative 范围不存在或未授权")
            return {"kind": "initiative", "scope": scope, "items": scoped}
        if scope.startswith("owner:"):
            owner = scope.split(":", 1)[1]
            if owner != email:
                raise HTTPException(status_code=403, detail="只能查看本人的 Insight")
            return {
                "kind": "owner",
                "scope": scope,
                "items": [item for item in items if item.get("ownerId") == email],
            }
        if role == "lead" and scope == department:
            return {
                "kind": "department",
                "scope": scope,
                "items": [item for item in items if item.get("department") == department],
            }
        raise HTTPException(status_code=403, detail="无权访问此 Insight 范围")

    def _assert_read(self, descriptor: dict[str, Any]) -> None:
        role = str(getattr(self.user, "role", ""))
        if role == "owner" and descriptor["kind"] in {"owner", "initiative"}:
            return
        if role == "lead" and descriptor["kind"] == "department":
            return
        if role == "management" and descriptor["kind"] == "global":
            return
        raise HTTPException(status_code=403, detail="无权读取此 Insight")

    def _assert_generate(self, descriptor: dict[str, Any]) -> None:
        self._assert_read(descriptor)
        if getattr(self.user, "role", "") in {"owner", "lead"}:
            return
        raise HTTPException(status_code=403, detail="当前角色无权生成 Insight")

    def _assert_prompt_edit(self, descriptor: dict[str, Any]) -> NoReturn:
        raise HTTPException(
            status_code=403, detail="分析提示词由版本化能力包维护，用户只能选择已发布方案"
        )

    def _prompt_vo(self, prompt: InsightPromptDO, descriptor: dict[str, Any]) -> dict[str, Any]:
        return {"scope": prompt.scope, "text": "", "version": 0, "editable": False}

    def presets(self) -> list[dict[str, Any]]:
        return [
            {key: row[key] for key in ("id", "label", "description", "version")}
            for row in InsightPack(PACK_ROOT).manifest()["presets"]
        ]

    def _preset(self, preset_id: str) -> dict[str, Any]:
        try:
            return cast(dict[str, Any], InsightPack(PACK_ROOT).preset(preset_id))
        except PackError as exc:
            raise HTTPException(status_code=422, detail="未知 Insight 分析方案") from exc

    def _signature(
        self,
        workspace: dict[str, Any],
        scope: str,
        prompt: InsightPromptDO,
        preset_id: str = "comprehensive",
    ) -> str:
        state = workspace.get("state") or {}
        basis = {
            "scope": scope,
            "initiatives": state.get("initiatives") or [],
            "reference": state.get("reference") or {},
            "guide": state.get("guide") or {},
            "reasonVersion": state.get("budgetReasonVersion"),
            "promptVersion": prompt.version,
            "prompt": prompt.text,
        }
        descriptor = self._scope(workspace, scope)
        year = int(
            ((workspace.get("data") or {}).get("metadata") or {}).get("planningYear")
            or prompt.planning_year
        )
        evidence = build_evidence(workspace, descriptor, self.user.role, year)
        _, metadata = InsightPack(PACK_ROOT).compile(
            evidence, preset_id, model=getattr(self.settings, "ai_model", "qwen3.8-flash")
        )
        basis["capability"] = metadata
        payload = json.dumps(
            basis, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":")
        )
        return "basis-" + hashlib.sha256(payload.encode()).hexdigest()[:16]

    def _access(self, descriptor: dict[str, Any]) -> dict[str, Any]:
        # Historical analyses are hidden if the caller's data scope has narrowed.
        return {
            "email": self.user.email,
            "role": self.user.role,
            "department": self.user.department,
            "sectors": sorted(getattr(self.user, "sectors", ()) or ()),
            "initiativeIds": sorted(str(item["id"]) for item in descriptor["items"]),
        }

    @staticmethod
    def _reference(workspace: dict[str, Any]) -> dict[str, Any]:
        reference = (workspace.get("state") or {}).get("reference") or {}
        if isinstance(reference, list):
            first = reference[0] if reference else {}
            return {"batchId": first.get("batchId"), "asOf": first.get("asOf")} if first else {}
        return reference if isinstance(reference, dict) else {}

    def _evidence(
        self, workspace: dict[str, Any], descriptor: dict[str, Any]
    ) -> tuple[list[dict[str, Any]], str]:
        items = descriptor["items"]
        totals: dict[str, Decimal] = defaultdict(Decimal)
        dealers: dict[str, dict[str, Any]] = {}
        for item in items:
            totals["budget"] += self._money(item.get("budget"))
            for row in item.get("rows") or []:
                amount = self._money(row.get("amount"))
                totals["allocated"] += amount
                dealer = dealers.setdefault(
                    str(row.get("dealerId") or "UNKNOWN"), {"amount": Decimal(0), "count": 0}
                )
                dealer["amount"] += amount
                dealer["count"] += 1
            for row in item.get("otherBudgets") or []:
                totals["other"] += self._money(row.get("amount"))
        totals["gap"] = totals["budget"] - totals["allocated"] - totals["other"]
        top_id, top_data = max(
            dealers.items(), key=lambda pair: pair[1]["amount"], default=(None, {})
        )
        total_allocated = totals["allocated"]
        concentration = (
            Decimal(0)
            if top_id is None or not total_allocated
            else top_data["amount"] / total_allocated
        )
        common = {
            "范围 Initiative 数": len(items),
            "预算": self._number(totals["budget"]),
            "经销商分配": self._number(total_allocated),
        }
        histories = {
            str(row.get("id")): row.get("history") or {}
            for row in (workspace.get("data") or {}).get("dealers") or []
        }
        yields: list[tuple[str, Decimal, dict[str, Any]]] = []
        for dealer_id in dealers:
            history = histories.get(dealer_id, {})
            yield_value = self._numeric(history.get("yield"))
            if yield_value is not None:
                yields.append((dealer_id, yield_value, history))
        yields.sort(key=lambda row: row[1])
        low = yields[0] if yields else None
        high = yields[-1] if yields else None
        trend = next(
            (
                (dealer_id, history)
                for dealer_id, history in histories.items()
                if dealer_id in dealers
                and self._positive(history.get("vol2024"))
                and self._positive(history.get("c32024"))
                and self._numeric(history.get("vol2025")) is not None
                and self._numeric(history.get("c32025")) is not None
            ),
            None,
        )
        evidence = [
            self._yield_evidence(
                "low_yield", "历史低 Yield 与未来投入复核", low, dealers, common, descriptor
            ),
            self._yield_evidence(
                "high_yield", "历史高 Yield 与未来投入复核", high, dealers, common, descriptor
            ),
            {
                "key": "concentration",
                "finding": "头部 Distributor 分配集中度",
                "object": top_id or descriptor["scope"],
                "facts": {
                    **common,
                    "头部对象": top_id,
                    "头部金额": self._number(top_data["amount"]) if top_id else 0,
                    "头部占比": float(concentration.quantize(Decimal("0.0001"))),
                },
                "status": "observed" if top_id else "limited",
            },
            {
                "key": "overlap",
                "finding": "多 Initiative 叠加",
                "object": top_id or descriptor["scope"],
                "facts": {
                    **common,
                    "多项对象数": sum(1 for value in dealers.values() if value["count"] > 1),
                },
                "status": "review"
                if any(value["count"] > 1 for value in dealers.values())
                else "observed",
            },
            self._trend_evidence(trend, dealers, common, descriptor),
            {
                "key": "completeness",
                "finding": "预算完整性及其他预算",
                "object": descriptor["scope"],
                "facts": {
                    **common,
                    "其他预算": self._number(totals["other"]),
                    "未解释差额": self._number(totals["gap"]),
                },
                "status": "observed" if totals["gap"] == 0 else "review",
            },
        ]
        label = (
            "本人当前 Initiative 工作稿"
            if descriptor["kind"] in {"owner", "initiative"}
            else "本部门当前工作稿"
        )
        return evidence, label

    def _yield_evidence(
        self,
        key: str,
        finding: str,
        candidate: Any,
        dealers: dict[str, dict[str, Any]],
        common: dict[str, Any],
        descriptor: dict[str, Any],
    ) -> dict[str, Any]:
        if candidate is None:
            return {
                "key": key,
                "finding": finding,
                "object": descriptor["scope"],
                "facts": {**common, "历史": "缺少已授权可比 Yield 数据"},
                "status": "limited",
            }
        dealer_id, yield_value, _ = candidate
        return {
            "key": key,
            "finding": finding,
            "object": dealer_id,
            "facts": {
                **common,
                "2025 Yield": self._number(yield_value),
                "规划年度分配": self._number(dealers[dealer_id]["amount"]),
            },
            "status": "review",
        }

    def _trend_evidence(
        self,
        trend: Any,
        dealers: dict[str, dict[str, Any]],
        common: dict[str, Any],
        descriptor: dict[str, Any],
    ) -> dict[str, Any]:
        if trend is None:
            return {
                "key": "trend",
                "finding": "分配与历史 Vol/C3 趋势",
                "object": descriptor["scope"],
                "facts": {**common, "历史": "缺少可比 Vol/C3 证据"},
                "status": "limited",
            }
        dealer_id, history = trend
        vol24, vol25 = self._numeric(history.get("vol2024")), self._numeric(history.get("vol2025"))
        c324, c325 = self._numeric(history.get("c32024")), self._numeric(history.get("c32025"))
        if vol24 is None or vol25 is None or c324 is None or c325 is None or not vol24 or not c324:
            return self._trend_evidence(None, dealers, common, descriptor)
        return {
            "key": "trend",
            "finding": "分配与历史 Vol/C3 趋势",
            "object": dealer_id,
            "facts": {
                **common,
                "2024 Vol": self._number(vol24),
                "2025 Vol": self._number(vol25),
                "Vol变化": float(((vol25 / vol24) - 1).quantize(Decimal("0.0001"))),
                "2024 C3": self._number(c324),
                "2025 C3": self._number(c325),
                "C3变化": float(((c325 / c324) - 1).quantize(Decimal("0.0001"))),
                "规划年度分配": self._number(dealers[dealer_id]["amount"]),
            },
            "status": "review",
        }

    async def _call_model(self, body: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        key = getattr(self.settings, "ai_api_key", None)
        secret = key.get_secret_value() if key else ""
        base = str(getattr(self.settings, "ai_base_url", "")).rstrip("/")
        if not secret or not base:
            raise HTTPException(status_code=503, detail="百炼 AI 尚未配置，原 Insight 记录已保留")
        url = base if base.endswith("/chat/completions") else base + "/chat/completions"
        timeout = float(getattr(self.settings, "ai_timeout_seconds", 120))
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    url, headers={"Authorization": f"Bearer {secret}"}, json=body
                )
                response.raise_for_status()
                payload = response.json()
            choice = payload["choices"][0]
            if choice.get("finish_reason") not in {None, "stop"}:
                raise ValueError("incomplete model response")
            parsed = json.loads(choice["message"]["content"])
            if not isinstance(parsed, dict):
                raise ValueError("result must be object")
            return parsed, payload.get("usage") or {}
        except (httpx.HTTPError, IndexError, KeyError, TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=502, detail="百炼 Insight 生成失败，原记录已保留"
            ) from exc

    def _record(
        self,
        scope: str,
        signature: str,
        prompt: InsightPromptDO,
        workspace: dict[str, Any],
        evidence: list[dict[str, Any]],
        basis: str,
        reviews: dict[str, str],
    ) -> dict[str, Any]:
        state = workspace.get("state") or {}
        guide = state.get("guide") or {}
        reference = self._reference(workspace)
        rows = []
        for item in evidence:
            parts = []
            for label, value in item["facts"].items():
                if value is None:
                    value = "无可比数据"
                elif label in {"头部占比", "Vol变化", "C3变化"}:
                    value = f"{value * 100:.2f}%"
                parts.append(f"{label}：{value}")
            facts = "；".join(parts) + "。"
            review = reviews[item["key"]]
            rows.append(
                {
                    "key": item["key"],
                    "finding": item["finding"],
                    "object": item["object"],
                    "evidence": facts,
                    "review": review,
                    "text": facts + " " + review,
                    "status": item["status"],
                }
            )
        return {
            "scope": scope,
            "status": "generated",
            "signature": signature,
            "analysisMethodVersion": "v1.4-evidence-six-point",
            "reference": reference,
            "guideVersion": int(guide.get("version") or 0),
            "createdAt": datetime.now(UTC).isoformat(),
            "basisLabel": basis,
            "items": rows,
            "guideText": str(guide.get("text") or ""),
            "promptText": prompt.text,
            "promptVersion": prompt.version,
            "promptScope": scope,
            "disclaimer": "AI 仅解释后端已授权事实；不计算金额、不修改预算、不作因果推断。",
            "stale": False,
        }

    @staticmethod
    def _money(value: Any) -> Decimal:
        parsed = InsightService._numeric(value)
        return parsed if parsed is not None else Decimal(0)

    @staticmethod
    def _number(value: Decimal) -> float:
        return float(value.quantize(Decimal("0.01")))

    @staticmethod
    def _numeric(value: Any) -> Decimal | None:
        try:
            parsed = Decimal(str(value)) if value is not None else None
            return parsed if parsed is not None and parsed.is_finite() else None
        except Exception:
            return None

    def _positive(self, value: Any) -> bool:
        parsed = self._numeric(value)
        return parsed is not None and parsed > 0
