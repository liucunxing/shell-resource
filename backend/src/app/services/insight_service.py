"""Small, evidence-led integration with BaiLian's OpenAI-compatible API."""

import asyncio
import hashlib
import json
import logging
from collections import defaultdict
from datetime import UTC, datetime
from decimal import Decimal
from time import perf_counter
from typing import Any, cast
from uuid import uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.departments import departments
from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.insight import InsightPromptDO, InsightRecordDO
from app.repositories.insight_repository import InsightRepository
from app.services.dealer_history import scoped_dealer_histories
from app.services.insight_investment import InvestmentRules
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
logger = logging.getLogger(__name__)


class ModelResponseError(ValueError):
    """A classified provider response failure, without response text or input."""

    def __init__(self, reason: str, *, retryable: bool = False) -> None:
        super().__init__(reason)
        self.retryable = retryable


def _safe_request_id(value: Any) -> str:
    return "".join(char for char in str(value or "")[:128] if char.isalnum() or char in "-_")


STRUCTURED_OUTPUT_ABORT_MESSAGE = (
    "Model output became abnormal while generating a JSON response for response_format. "
    "The generation was aborted because the partial output may be incomplete or invalid JSON. "
    "Please retry the request or adjust your prompt or JSON schema."
)


def _provider_error(payload: dict[str, Any], diagnostics: dict[str, Any]) -> ModelResponseError:
    """Classify only the verified provider abort; never retain its raw message."""
    diagnostics["request_id"] = _safe_request_id(payload.get("id")) or diagnostics.get(
        "request_id", ""
    )
    error = payload.get("error")
    error = error if isinstance(error, dict) else {}
    # Keep known enum values only, rather than arbitrary provider-controlled text.
    code, kind = error.get("code"), error.get("type")
    diagnostics["error_code"] = (
        "invalid_parameter_error" if code == "invalid_parameter_error" else "other"
    )
    diagnostics["error_type"] = (
        "invalid_request_error" if kind == "invalid_request_error" else "other"
    )
    if (
        code == "invalid_parameter_error"
        and kind == "invalid_request_error"
        and error.get("message") == STRUCTURED_OUTPUT_ABORT_MESSAGE
    ):
        return ModelResponseError("structured_output_aborted")
    return ModelResponseError("provider_error_frame")


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

    def _log(self, level: int, message: str, *args: Any) -> None:
        context = getattr(self, "_log_context", {})
        logger.log(
            level,
            message + " context=%s stage=%s",
            *args,
            json.dumps(
                {
                    **context,
                    "provider_request_id": _safe_request_id(
                        getattr(self, "_model_diagnostics", {}).get("request_id")
                    ),
                },
                ensure_ascii=True,
            ),
            getattr(self, "_stage", "unknown"),
        )

    async def get_insight(
        self, *, scope: str, planning_year: int, preset_id: str = "comprehensive"
    ) -> dict[str, Any]:
        self._preset(preset_id)
        workspace = await self._workspace(planning_year)
        descriptor = self._scope(workspace, scope)
        self._assert_read(descriptor)
        prompt = await self._prompt(planning_year, scope, descriptor)
        record: dict[str, Any] | None
        record = None
        saved = await self.repository.latest_record(
            planning_year, scope, self.user.email, preset_id
        )
        if saved and self._record_access_matches(saved.record.get("access"), descriptor):
            record = dict(saved.record)
            record["stale"] = record.get("signature") != self._signature(
                workspace, scope, prompt, preset_id
            )
        if record is None and self.user.role in {"management", "admin"}:
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
            record["evidence"] = build_evidence(
                workspace,
                descriptor,
                self.user.role,
                planning_year,
                investment_rules=self._investment_rules(),
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
        from app.repositories.workspace_repository import WorkspaceRepository
        from app.services.admin_service import AdminService

        # The config row also serializes first creation (there is no prompt row to lock yet).
        await AdminService(self.session, self.user)._locked_config()
        prompt = await self.repository.get_prompt_for_update(planning_year, scope)
        if (prompt.version if prompt else 0) != expected_version:
            raise HTTPException(status_code=409, detail="提示词已更新，请刷新后再保存")
        clean_text = text.strip()
        if not clean_text:
            raise HTTPException(status_code=422, detail="请填写分析关注点")
        if prompt is None:
            prompt = await self.repository.add_prompt(
                InsightPromptDO(
                    planning_year=planning_year,
                    scope=scope,
                    text=clean_text,
                    version=0,
                    versions=[],
                )
            )
        versions = list(prompt.versions or [])
        if prompt.version and not versions:
            versions.append({"version": prompt.version, "text": prompt.text})
        prompt.version += 1
        prompt.text = clean_text
        prompt.versions = [
            *versions,
            {
                "version": prompt.version,
                "text": clean_text,
                "updatedAt": datetime.now(UTC).isoformat(),
                "updatedBy": self.user.email,
            },
        ]
        WorkspaceRepository(self.session).add_log(
            0,
            "PROMPT_UPDATE",
            self.user.email,
            None,
            {"scope": scope, "planningYear": planning_year, "version": prompt.version},
        )
        result = self._prompt_vo(prompt, descriptor)
        await self.session.commit()
        return result

    async def generate(
        self, *, scope: str, planning_year: int, preset_id: str = "comprehensive"
    ) -> dict[str, Any]:
        deadline = float(getattr(self.settings, "insight_timeout_seconds", 60))
        started = perf_counter()
        self._deadline_at = started + deadline
        self._request_id = uuid4().hex
        self._structured_fallback_used = False
        self._stage = "prepare"
        self._model_diagnostics: dict[str, Any] = {}
        self._log_context = {
            "request_id": self._request_id,
            "preset": _safe_request_id(preset_id),
            "year": planning_year,
            "scope_hash": hashlib.sha256(scope.encode()).hexdigest()[:16],
            "user_hash": hashlib.sha256(str(self.user.email).lower().encode()).hexdigest()[:16],
        }
        self._log(logging.INFO, "insight.generate_started")
        try:
            async with asyncio.timeout(deadline):
                record = await self._generate(
                    scope=scope, planning_year=planning_year, preset_id=preset_id
                )
                self._log(
                    logging.INFO,
                    "insight.generate_complete preset=%s elapsed=%.3f attempts=%d",
                    _safe_request_id(preset_id),
                    perf_counter() - started,
                    len(record.get("metadata", {}).get("attempts", [])),
                )
                return record
        except TimeoutError as exc:
            self._log(
                logging.WARNING,
                "insight.generate_timeout preset=%s elapsed=%.3f deadline=%.3f diagnostics=%s",
                _safe_request_id(preset_id),
                perf_counter() - started,
                deadline,
                json.dumps(self._model_diagnostics, ensure_ascii=True),
            )
            raise HTTPException(
                status_code=504,
                detail="分析等待超时，原记录已保留，请稍后重试",
                headers={"X-Insight-Request-ID": self._request_id},
            ) from exc
        except HTTPException as exc:
            exc.headers = {**(exc.headers or {}), "X-Insight-Request-ID": self._request_id}
            self._log(
                logging.WARNING,
                "insight.generate_failed preset=%s status=%d elapsed=%.3f",
                _safe_request_id(preset_id),
                exc.status_code,
                perf_counter() - started,
            )
            raise
        except SQLAlchemyError as exc:
            self._log(
                logging.WARNING, "insight.database_unavailable category=%s", type(exc).__name__
            )
            raise HTTPException(
                status_code=503,
                detail="数据库暂不可用，请检查连接与表结构后重试",
                headers={"X-Insight-Request-ID": self._request_id},
            ) from None
        except Exception as exc:
            self._log(logging.ERROR, "insight.generate_unexpected category=%s", type(exc).__name__)
            # A handled HTTPException prevents ServerErrorMiddleware from re-raising
            # the original exception into Uvicorn's potentially sensitive traceback.
            raise HTTPException(
                status_code=500,
                detail="Insight 生成失败，原记录已保留",
                headers={"X-Insight-Request-ID": self._request_id},
            ) from None

    def _investment_rules(self) -> InvestmentRules:
        return InvestmentRules(
            increase_multiple=getattr(self.settings, "insight_investment_increase_multiple", 2),
            decrease_multiple=getattr(self.settings, "insight_investment_decrease_multiple", 0.5),
            absolute_change=getattr(self.settings, "insight_investment_absolute_change", 50000),
        )

    async def _generate(self, *, scope: str, planning_year: int, preset_id: str) -> dict[str, Any]:
        started = perf_counter()
        self._preset(preset_id)
        workspace = await self._workspace(planning_year)
        descriptor = self._scope(workspace, scope)
        self._assert_generate(descriptor)
        prompt = await self._prompt(planning_year, scope, descriptor)
        signature = self._signature(workspace, scope, prompt, preset_id)
        access = self._access(descriptor)
        evidence = build_evidence(
            workspace,
            descriptor,
            self.user.role,
            planning_year,
            investment_rules=self._investment_rules(),
        )
        pack = InsightPack(PACK_ROOT)
        body, metadata = pack.compile(
            evidence, preset_id, model=self.settings.ai_model, thinking=False
        )
        if prompt.version:
            body["messages"].append(
                {
                    "role": "user",
                    "content": "以下是管理员设置的业务关注点，仅调整解读重点和表达。"
                    "不得修改系统规定的事实、金额、权限范围、输出结构或校验规则：\n" + prompt.text,
                }
            )
        await self._finish_read_transaction()
        prepared = perf_counter()
        attempts = []
        for attempt in range(2):
            call_started = perf_counter()
            self._stage = "model"
            self._log_context["validation_attempt"] = attempt + 1
            candidate, usage = await self._call_model(body)
            self._stage = "validate"
            call_seconds = perf_counter() - call_started
            diagnostic: dict[str, Any] = {
                "model_seconds": round(call_seconds, 3),
                "usage": usage,
                "request_bytes": len(json.dumps(body, ensure_ascii=False).encode("utf-8")),
            }
            attempts.append(diagnostic)
            try:
                result, normalizations = normalize_result(pack.unpack_model_result(candidate))
                pack.validate_schema(result, "output_schema")
                pack.validate_model_references(result, evidence, preset_id)
                result, bindings = pack.resolve_fact_tokens(result, evidence)
                result, citation_bindings = pack.bind_named_facts(result, evidence)
                pack.validate_model_references(result, evidence, preset_id)
                pack.validate_consistency(result, evidence, preset_id)
                result = pack.format_result_display(result)
                pack.validate_consistency(result, evidence, preset_id)
                diagnostic["validation"] = "passed"
                break
            except PackError as exc:
                diagnostic["validation"] = "rejected"
                diagnostic["reason"] = str(exc)
                self._log(
                    logging.WARNING,
                    "insight.validation_failed preset=%s attempt=%d reason=%s",
                    preset_id,
                    attempt + 1,
                    str(exc),
                )
                if attempt:
                    raise HTTPException(
                        status_code=502, detail="分析与证据不一致，原记录已保留，请稍后重试"
                    ) from exc
                body["messages"].extend(
                    [
                        {"role": "assistant", "content": json.dumps(candidate, ensure_ascii=False)},
                        {
                            "role": "user",
                            "content": "上次候选未通过校验。修复这些问题，返回完整JSON；"
                            "不增加事实或改变允许状态。用task.execution_anchor中对应维度的"
                            "完整句子重写报错字段；删除无证据的分组数量、合计占比及对象名称，"
                            "不能只把原句的错误数字换成占位符。必显复核正文仍需完整保留："
                            + str(exc),
                        },
                    ]
                )
        usage = {
            key: sum(a["usage"].get(key, 0) for a in attempts)
            for key in ("prompt_tokens", "completion_tokens", "total_tokens")
        }
        if perf_counter() >= self._deadline_at:
            raise TimeoutError
        self._stage = "recheck_authorization"
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
            "basisLabel": "各项最新同步快照"
            if self.user.role in {"management", "admin"}
            else "当前授权工作稿",
            "dataVersions": [
                {
                    "initiativeId": item["id"],
                    "revision": item.get("publishedRevision"),
                    "publishedAt": item.get("publishedAt"),
                }
                for item in descriptor["items"]
            ],
            "guideText": str(guide.get("text") or ""),
            "promptText": prompt.text,
            "promptVersion": prompt.version,
            "promptScope": prompt.scope,
            "presetId": preset_id,
            "result": result,
            "evidence": evidence,
            "metadata": {
                **metadata,
                "request_id": self._request_id,
                "usage": usage,
                "normalizations": normalizations,
                "fact_bindings": bindings,
                "citation_bindings": citation_bindings,
                "guide_version": int(guide.get("version") or 0),
                "attempts": attempts,
                "timing": {
                    "prepare_seconds": round(prepared - started, 3),
                    "before_save_seconds": round(perf_counter() - started, 3),
                    "deadline_seconds": float(
                        getattr(self.settings, "insight_timeout_seconds", 60)
                    ),
                },
            },
            "items": [],
            "access": access,
            "disclaimer": "AI 仅解释后端已授权事实；不修改预算、不作因果推断。",
            "stale": signature
            != self._signature(current_workspace, scope, current_prompt, preset_id),
        }
        await self._finish_read_transaction()

        self._stage = "save"
        if perf_counter() >= self._deadline_at:
            raise TimeoutError
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
        self._stage = "complete"
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

        return await WorkspaceService(self.session, self.user).get_workspace(
            planning_year, synced_only=self.user.role in {"management", "admin"}
        )

    async def _prompt(
        self, planning_year: int, scope: str, descriptor: dict[str, Any]
    ) -> InsightPromptDO:
        prompt = await self.repository.get_prompt(planning_year, "global")
        if prompt is None and scope != "global":
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
        from app.core.resource_access import default_department_resources

        mapping = state.get("departmentResources", default_department_resources())
        self._visible_resources = sorted(
            {
                resource
                for dep in departments(self.user.department)
                for resource in mapping.get(dep, [])
            }
        )
        items = list(state.get("initiatives") or [])
        role = str(getattr(self.user, "role", ""))
        email = str(getattr(self.user, "email", ""))
        user_departments = departments(getattr(self.user, "department", None))
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
        if role == "lead" and scope in user_departments:
            return {
                "kind": "department",
                "scope": scope,
                "items": [item for item in items if item.get("department") == scope],
            }
        raise HTTPException(status_code=403, detail="无权访问此 Insight 范围")

    def _assert_read(self, descriptor: dict[str, Any]) -> None:
        role = str(getattr(self.user, "role", ""))
        if role == "owner" and descriptor["kind"] in {"owner", "initiative"}:
            return
        if role == "lead" and descriptor["kind"] == "department":
            return
        if role in {"management", "admin"} and descriptor["kind"] == "global":
            return
        raise HTTPException(status_code=403, detail="无权读取此 Insight")

    def _assert_generate(self, descriptor: dict[str, Any]) -> None:
        self._assert_read(descriptor)
        if self.user.role in {"management", "admin"} and not descriptor["items"]:
            raise HTTPException(
                status_code=422, detail="当前还没有已同步项目，请先由 Owner 同步分配"
            )
        if getattr(self.user, "role", "") in {"owner", "lead", "management", "admin"}:
            return
        raise HTTPException(status_code=403, detail="当前角色无权生成 Insight")

    def _assert_prompt_edit(self, descriptor: dict[str, Any]) -> None:
        if self.user.role != "admin" or descriptor["kind"] != "global":
            raise HTTPException(status_code=403, detail="仅管理员可编辑全局业务分析提示词")

    def _prompt_vo(self, prompt: InsightPromptDO, descriptor: dict[str, Any]) -> dict[str, Any]:
        return {
            "scope": prompt.scope,
            "text": prompt.text if self.user.role == "admin" else "",
            "version": prompt.version,
            "editable": self.user.role == "admin",
            "versions": list(prompt.versions or []) if self.user.role == "admin" else [],
        }

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
        evidence = build_evidence(
            workspace,
            descriptor,
            self.user.role,
            year,
            investment_rules=self._investment_rules(),
        )
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
            "historicalResources": getattr(self, "_visible_resources", [])
            if self.user.role in {"owner", "lead"}
            else "all",
            "department": sorted(departments(self.user.department)),
            "sectors": sorted(getattr(self.user, "sectors", ()) or ()),
            "initiativeIds": sorted(str(item["id"]) for item in descriptor["items"]),
        }

    def _record_access_matches(self, saved: Any, descriptor: dict[str, Any]) -> bool:
        current = self._access(descriptor)
        if not isinstance(saved, dict):
            return False
        if "historicalResources" in saved:
            return saved == current
        # Preserve compatible pre-upgrade records; never expose an old Lead analysis
        # with unrestricted amounts after the new department restriction takes effect.
        if saved != {key: value for key, value in current.items() if key != "historicalResources"}:
            return False
        if self.user.role not in {"owner", "lead"}:
            return True
        old_mapping = {"MKT": {"MRD", "SP&A"}, "ICE": {"ICE Rebate"}, "CAPEX": {"Capex"}}
        previous = (
            {"MRD", "SP&A", "ICE Rebate", "Capex"}
            if self.user.role == "lead"
            else set().union(
                *(old_mapping.get(dep, set()) for dep in departments(self.user.department))
            )
        )
        return previous.issubset(current["historicalResources"])

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
            code: row.get("history") or {}
            for code, row in scoped_dealer_histories(
                (workspace.get("data") or {}).get("dealers") or [], items
            ).items()
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
        """Retry one transient connection/provider failure within the shared deadline."""
        started = perf_counter()
        request_body = body
        for attempt in range(2):
            if hasattr(self, "_log_context"):
                self._log_context["transport_attempt"] = attempt + 1
            try:
                result, usage = await self._call_model_once(request_body)
                usage["transport_attempts"] = attempt + 1
                return result, usage
            except HTTPException as exc:
                cause = exc.__cause__
                status = (
                    cause.response.status_code if isinstance(cause, httpx.HTTPStatusError) else 0
                )
                incomplete = (
                    isinstance(cause, ModelResponseError)
                    and cause.retryable
                    or (isinstance(cause, json.JSONDecodeError))
                    or (
                        isinstance(cause, ValueError)
                        and str(cause) in {"incomplete model stream", "incomplete model response"}
                    )
                )
                structured_abort = (
                    isinstance(cause, ModelResponseError)
                    and str(cause) == "structured_output_aborted"
                )
                schema = (body.get("response_format", {}).get("json_schema") or {}).get("schema")
                fallback = (
                    structured_abort
                    and isinstance(schema, dict)
                    and body.get("response_format", {}).get("type") == "json_schema"
                    and not getattr(self, "_structured_fallback_used", False)
                )
                retryable = (
                    fallback
                    or incomplete
                    or isinstance(cause, httpx.TransportError)
                    or (isinstance(cause, httpx.HTTPStatusError) and status in {429, 502, 503, 504})
                )
                request_id = (
                    cause.response.headers.get("x-request-id", "")
                    if isinstance(cause, httpx.HTTPStatusError)
                    else ""
                )
                diagnostics = getattr(exc, "model_diagnostics", {})
                status = diagnostics.get("provider_status", status)
                safe_request_id = _safe_request_id(request_id or diagnostics.get("request_id"))
                remaining = getattr(self, "_deadline_at", started + 60) - perf_counter()
                retry = attempt == 0 and retryable and remaining > 5
                self._log(
                    logging.WARNING,
                    "insight.model_failed category=%s provider_status=%d request_id=%s "
                    "attempt=%d elapsed=%.3f retry=%s diagnostics=%s",
                    str(cause)
                    if isinstance(cause, ModelResponseError)
                    else "incomplete_response"
                    if incomplete
                    else type(cause).__name__
                    if cause
                    else "configuration",
                    status,
                    safe_request_id or "-",
                    attempt + 1,
                    perf_counter() - started,
                    retry,
                    json.dumps(diagnostics, ensure_ascii=True),
                )
                if not retry:
                    raise
                if fallback:
                    # Persist this transport choice so a later validation repair does not
                    # return to the same provider schema decoder that just aborted.
                    self._structured_fallback_used = True
                    body["messages"].insert(
                        0,
                        {
                            "role": "system",
                            "content": "Return a complete JSON object matching this JSON Schema. "
                            "Required properties, authorized references and constraints apply. "
                            "Do not return partial content or Markdown. JSON Schema: "
                            + json.dumps(schema, ensure_ascii=False, separators=(",", ":")),
                        },
                    )
                    body["response_format"] = {"type": "json_object"}
                    body["stream"] = False
                    body.pop("stream_options", None)
                    request_body = body
                # A second connection using ordinary JSON avoids repeating a broken
                # SSE framing/stream. It still needs the same schema and fact checks.
                if incomplete or isinstance(cause, httpx.TransportError):
                    request_body = {**body, "stream": False}
                await asyncio.sleep(0.25)
        raise RuntimeError("unreachable model retry state")

    async def _call_model_once(self, body: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        key = getattr(self.settings, "ai_api_key", None)
        secret = key.get_secret_value() if key else ""
        base = str(getattr(self.settings, "ai_base_url", "")).rstrip("/")
        if not secret or not base:
            raise HTTPException(status_code=503, detail="百炼 AI 尚未配置，原 Insight 记录已保留")
        url = base if base.endswith("/chat/completions") else base + "/chat/completions"
        timeout = float(getattr(self.settings, "ai_timeout_seconds", 120))
        started = perf_counter()
        streaming = body.get("stream", True)
        request_body = {**body, "stream": streaming}
        if streaming:
            request_body["stream_options"] = {"include_usage": True}
        else:
            request_body.pop("stream_options", None)
        diagnostics: dict[str, Any] = {
            "mode": "sse" if streaming else "json",
            "response_format": request_body.get("response_format", {}).get("type", "unspecified"),
            "stage": "connect",
            "chunks": 0,
            "data_bytes": 0,
            "content_bytes": 0,
            "finish_reason": None,
            "done_received": False,
        }
        self._model_diagnostics = diagnostics
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                    "POST",
                    url,
                    headers={"Authorization": f"Bearer {secret}"},
                    json=request_body,
                ) as response:
                    diagnostics["request_id"] = _safe_request_id(
                        response.headers.get("x-request-id")
                    )
                    diagnostics["provider_status"] = response.status_code
                    if response.is_error:
                        await response.aread()
                        try:
                            error_payload = response.json()
                        except ValueError:
                            error_payload = None
                        if isinstance(error_payload, dict) and error_payload.get("error"):
                            classified = _provider_error(error_payload, diagnostics)
                            if str(classified) == "structured_output_aborted":
                                raise classified
                        response.raise_for_status()
                    diagnostics["stage"] = "receive"
                    if "text/event-stream" in response.headers.get("content-type", ""):
                        parts: list[str] = []
                        usage: dict[str, Any] = {}
                        finish = None
                        first_token = None
                        request_id = None
                        async for line in response.aiter_lines():
                            if not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if data == "[DONE]":
                                diagnostics["done_received"] = True
                                break
                            if not data:
                                continue
                            diagnostics["data_bytes"] += len(data.encode("utf-8"))
                            diagnostics["chunks"] += 1
                            try:
                                chunk = json.loads(data)
                            except json.JSONDecodeError as exc:
                                raise ModelResponseError("malformed_sse", retryable=True) from exc
                            if not isinstance(chunk, dict):
                                raise ModelResponseError("invalid_sse_frame", retryable=True)
                            if chunk.get("error"):
                                raise _provider_error(chunk, diagnostics)
                            request_id = chunk.get("id") or request_id
                            diagnostics["request_id"] = (
                                _safe_request_id(request_id) or diagnostics["request_id"]
                            )
                            if chunk.get("usage"):
                                usage = chunk["usage"]
                            for item in chunk.get("choices", []):
                                content = item.get("delta", {}).get("content")
                                if content:
                                    if first_token is None:
                                        first_token = round(perf_counter() - started, 3)
                                        diagnostics["first_token_seconds"] = first_token
                                    parts.append(content)
                                    diagnostics["content_bytes"] += len(content.encode("utf-8"))
                                finish = item.get("finish_reason") or finish
                                diagnostics["finish_reason"] = (
                                    finish
                                    if finish in {"stop", "length", "content_filter", None}
                                    else "other"
                                )
                        if finish != "stop":
                            raise ModelResponseError(
                                "output_limit"
                                if finish == "length"
                                else "content_filter"
                                if finish == "content_filter"
                                else "stream_eof"
                                if finish is None
                                else "provider_finish",
                                retryable=finish is None,
                            )
                        payload: dict[str, Any] = {
                            "choices": [
                                {"message": {"content": "".join(parts)}, "finish_reason": finish}
                            ],
                            "usage": {
                                **usage,
                                "request_id": request_id,
                                "first_token_seconds": first_token,
                            },
                        }
                    else:
                        # Compatible gateways may return ordinary JSON.
                        await response.aread()
                        diagnostics["data_bytes"] = len(response.content)
                        payload = response.json()
                        if not isinstance(payload, dict):
                            raise ModelResponseError("invalid_response_object")
                        if payload.get("error"):
                            raise _provider_error(payload, diagnostics)
            diagnostics["request_id"] = (
                _safe_request_id(payload.get("id")) or diagnostics["request_id"]
            )
            choice = payload["choices"][0]
            finish = choice.get("finish_reason")
            diagnostics["finish_reason"] = (
                finish if finish in {"stop", "length", "content_filter", None} else "other"
            )
            content = choice["message"]["content"]
            diagnostics["content_bytes"] = len(content.encode("utf-8"))
            if choice.get("finish_reason") not in {None, "stop"}:
                raise ModelResponseError(
                    "output_limit" if finish == "length" else "provider_finish"
                )
            diagnostics["stage"] = "parse_content"
            parsed = json.loads(content)
            if not isinstance(parsed, dict):
                raise ModelResponseError("non_object_result")
            diagnostics["stage"] = "complete"
            diagnostics["elapsed_seconds"] = round(perf_counter() - started, 3)
            return parsed, {**(payload.get("usage") or {}), "response_diagnostics": diagnostics}
        except (httpx.HTTPError, IndexError, KeyError, TypeError, ValueError) as exc:
            diagnostics["elapsed_seconds"] = round(perf_counter() - started, 3)
            error = HTTPException(status_code=502, detail="百炼 Insight 生成失败，原记录已保留")
            error.model_diagnostics = diagnostics
            raise error from exc

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
