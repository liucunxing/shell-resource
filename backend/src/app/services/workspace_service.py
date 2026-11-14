from decimal import Decimal
from typing import Protocol

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.departments import departments
from app.core.resource_access import default_department_resources
from app.core.timestamps import iso_timestamp
from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.budget import BudgetDO
from app.models.do.planning import PlanningVersionDO
from app.models.do.workspace import (
    BudgetChangeLogDO,
    UserPermissionDO,
    WorkspacePublicationDO,
    default_budget_reasons,
)
from app.repositories.workspace_repository import WorkspaceRepository
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO, PublishDTO
from app.services.distributor_directory_service import DistributorDirectoryService
from app.services.history_snapshot import history_snapshot
from app.services.planning_service import PlanningService, version_view
from app.services.reference_service import ReferenceService


class DistributorDirectory(Protocol):
    async def distributor_codes(self, sectors: tuple[str, ...]) -> set[str]: ...


class WorkspaceService:
    """V1.4 draft and publication operations. Values are Decimal until projection."""

    def __init__(
        self,
        session: AsyncSession,
        user: WorkbenchUser,
        directory_service: DistributorDirectory | None = None,
    ) -> None:
        self.session = session
        self.user = user
        self.repository = WorkspaceRepository(session)
        self.directory_service = directory_service or DistributorDirectoryService(session)

    async def get_workspace(
        self, planning_year: int, *, synced_only: bool = False, version_id: str | None = None
    ) -> dict:
        department, sector, owner = self._scope()
        planning = PlanningService(self.session, self.user)
        version = await planning.resolve(planning_year, version_id)
        config = await self.repository.config()
        users = await self.repository.list_users() if self.user.role == "admin" else []
        if version:
            # Hold the same version lock as workflow mutations while projecting a coherent read.
            version = await planning.version(version.id, lock=True)
            budgets = await self.repository.list_budgets(
                planning_year, department, sector, owner, version.id
            )
            initiatives, publications = [], []
            for budget in budgets:
                if not planning.permitted(budget) or (
                    not budget.enabled and self.user.role != "admin"
                ):
                    continue
                workflow = await planning.workflow(budget, version)
                history = await self.repository.publications_for(budget.id)
                publication = history[-1] if history else None
                visible = (
                    self.user.role in {"owner", "admin"}
                    or (self.user.role == "lead" and workflow["submitted"])
                    or workflow["confirmed"]
                )
                # Upper levels receive only submitted / confirmed immutable snapshots.
                if self.user.role in {"lead", "management"} or synced_only:
                    item = (
                        self._publication(publication)["initiative"]
                        if visible and publication
                        else self._budget_projection(budget, [], [])
                    )
                else:
                    item = self._budget_projection(
                        budget,
                        await self.repository.rows_for(budget.id),
                        await self.repository.other_for(budget.id),
                        publication,
                    )
                item.update(
                    planningVersionId=version.id,
                    initiativeKey=budget.initiative_key,
                    enabled=budget.enabled,
                    workflow=workflow,
                    editable=workflow["editable"],
                    allocationVisible=visible,
                    changeReason=workflow["changeReason"],
                )
                if not visible:
                    workflow["changeReason"] = ""
                    item["changeReason"] = ""
                    item.update(
                        rows=[],
                        otherBudgets=[],
                        reserve=None,
                        nonDealer=None,
                        publishedAt=None,
                        publishedRevision=None,
                    )
                initiatives.append(item)
                if self.user.role in {"owner", "admin"}:
                    publications.extend(history)
                elif visible and publication:
                    publications.append(publication)
        elif self.user.role == "management" or synced_only:
            publications = await self.repository.latest_publications(
                planning_year, department, sector, owner
            )
            initiatives = [self._publication(item)["initiative"] for item in publications]
        else:
            budgets = await self.repository.list_budgets(planning_year, department, sector, owner)
            initiatives = []
            publications = []
            for budget in budgets:
                rows = await self.repository.rows_for(budget.id)
                other = await self.repository.other_for(budget.id)
                history = await self.repository.publications_for(budget.id)
                initiatives.append(
                    self._budget_projection(budget, rows, other, history[-1] if history else None)
                )
                publications.extend(history)
        budget_ids = [int(item["id"]) for item in initiatives if str(item.get("id", "")).isdigit()]
        reference_service = ReferenceService(self.session)
        dealers = await reference_service.get_dealers(
            planning_year,
            self.user.departments if self.user.role in {"owner", "lead"} else None,
            sectors=self.user.dealer_sectors,
            user=self.user,
        )
        snapshot = history_snapshot(planning_year, dealers)
        audit = []
        if self.user.role != "management":
            audit = [
                self._audit(item)
                for item in await self.repository.logs_for(
                    budget_ids, admin=self.user.role == "admin"
                )
            ]
        state = {
            "schemaVersion": 3 if version else 2,
            "planningVersion": version_view(version) if version else None,
            "currentVersionId": version.id if version else None,
            "planningVersions": [version_view(v) for v in await planning.versions(planning_year)],
            "roleResources": config.role_resources if config else {},
            "healthThresholds": config.health_thresholds if config else {},
            "departmentResources": config.department_resources
            if config
            else default_department_resources(),
            "dataBasis": "synced" if self.user.role == "management" or synced_only else "draft",
            "scenario": "api",
            "initiatives": initiatives,
            "departments": {
                name: {
                    "status": "collecting",
                    "versions": [],
                    "activeVersionId": None,
                    "comments": [],
                }
                for name in ("MKT", "ICE", "CAPEX")
            },
            "reference": snapshot["manifest"],
            "guide": config.guide if config else {"version": 0, "text": ""},
            "insights": {},
            "analysisPrompts": {},
            "budgetReasons": config.budget_reasons if config else default_budget_reasons(),
            "budgetReasonVersion": config.budget_reason_version if config else 0,
            "publications": self._publication_map(publications),
            "audit": audit,
            "final": None,
            "configRevision": config.revision if config else 0,
        }
        return {
            "identity": self._identity(),
            "state": state,
            "data": {
                "metadata": {"planningYear": planning_year},
                "historySnapshot": snapshot,
                "initiatives": initiatives,
                "allocations": [],
                "dealers": dealers,
            },
            "users": [self._user(item) for item in users],
        }

    async def _reference_metadata(self, planning_year: int) -> dict:
        dealers = await ReferenceService(self.session).get_dealers(
            planning_year,
            self.user.departments if self.user.role in {"owner", "lead"} else None,
            sectors=self.user.dealer_sectors,
            user=self.user,
        )
        return dict(history_snapshot(planning_year, dealers)["manifest"])

    async def get_draft(self, budget_id: int) -> dict:
        budget = await self._scoped_budget(budget_id, writable=False)
        history = await self.repository.publications_for(budget_id)
        item = self._budget_projection(
            budget,
            await self.repository.rows_for(budget.id),
            await self.repository.other_for(budget.id),
            history[-1] if history else None,
        )
        if budget.planning_version_id:
            planning = PlanningService(self.session, self.user)
            workflow = await planning.workflow(budget)
            if (
                self.user.role == "lead"
                and (budget.owner_email or "").lower() != self.user.email.lower()
            ):
                item = (
                    self._publication(history[-1])["initiative"]
                    if history and workflow["submitted"]
                    else self._budget_projection(budget, [], [])
                )
            item.update(
                workflow=workflow,
                editable=workflow["editable"],
                changeReason=workflow["changeReason"],
            )
        return item

    async def save_draft(self, budget_id: int, payload: InitiativeDraftUpdateDTO) -> dict:
        budget = await self._scoped_budget(budget_id, writable=True, for_update=True)
        await self._validate_rows(payload.rows, payload.otherBudgets, budget)
        if budget.revision != payload.expected_revision:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="草稿已被其他用户修改，请刷新后重试"
            )
        async with self.session.begin_nested():
            await self.repository.replace_rows(budget, [item.model_dump() for item in payload.rows])
            await self.repository.replace_other(
                budget_id, [item.model_dump() for item in payload.otherBudgets]
            )
            budget.revision += 1
            budget.status = 0
            if budget.planning_version_id:
                planning = PlanningService(self.session, self.user)
                workflow = await planning.ensure_state(budget.id)
                workflow.change_reason = payload.changeReason.strip()
                version = await planning.version(budget.planning_version_id)
                version.revision += 1
            budget.allocate_budget_amount = sum(
                (item.amount for item in payload.rows), Decimal("0")
            ) + sum((item.amount for item in payload.otherBudgets), Decimal("0"))
            self.repository.add_log(
                budget_id, "DRAFT_SAVE", self.user.email, None, {"revision": budget.revision}
            )
            await self.session.flush()
        await self.session.commit()
        return await self.get_draft(budget_id)

    async def publish(self, budget_id: int, payload: PublishDTO) -> dict:
        budget = await self._scoped_budget(budget_id, writable=True, for_update=True)
        if budget.revision != payload.expected_revision:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="草稿已被其他用户修改，请刷新后重试"
            )
        rows, other = (
            await self.repository.rows_for(budget_id),
            await self.repository.other_for(budget_id),
        )
        if budget.planning_version_id:
            await self._validate_version_dealer_scope(
                budget, {item.history_key or item.distributor_code for item in rows}
            )
            if any(
                item.sector != budget.sector or item.department != budget.department
                for item in rows
            ):
                raise HTTPException(422, "名单所属业务线或部门与项目不一致，请核对并重新保存草稿")
        total = sum((item.distributor_budget_amount for item in rows), Decimal("0")) + sum(
            (item.amount for item in other), Decimal("0")
        )
        if total != budget.plan_budget_amount:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="同步前经销商及其他预算之和必须等于总预算",
            )
        if not budget.planning_version_id and any(
            item.amount and not (item.note or "").strip() for item in other
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="非零其他预算必须填写说明"
            )
        submission_reason = payload.note.strip()
        if budget.planning_version_id:
            planning = PlanningService(self.session, self.user)
            version = await planning.version(budget.planning_version_id)
            workflow = await planning.ensure_state(budget.id)
            submission_reason = submission_reason or workflow.change_reason.strip()
            if version.source_version_id and not submission_reason:
                raise HTTPException(422, "请填写本版调整依据，继承方案需重新核对说明")
            if len(submission_reason) > 160:
                raise HTTPException(422, "本版调整依据最多 160 字")
            config = await self.repository.config()
            from app.core.resource_access import validate_submission_reasons

            try:
                validate_submission_reasons(
                    config.budget_reasons if config else default_budget_reasons(), other
                )
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
        old = await self.repository.publications_for(budget_id)
        initiative = self._budget_projection(budget, rows, other)
        if budget.planning_version_id:
            initiative["changeReason"] = submission_reason
        config = await self.repository.config()
        reference = await self._reference_metadata(budget.planning_year)
        async with self.session.begin_nested():
            budget.status = 1
            publication = WorkspacePublicationDO(
                budget_id=budget_id,
                department=budget.department,
                publication_number=len(old) + 1,
                published_revision=budget.revision,
                snapshot={
                    "initiative": initiative,
                    "reference": reference,
                    "guideVersion": (config.guide if config else {}).get("version", 0),
                },
                note=submission_reason or None,
            )
            self.session.add(publication)
            self.repository.add_log(
                budget_id,
                "PUBLISH",
                self.user.email,
                None,
                {"revision": budget.revision},
                payload.note,
            )
            await self.session.flush()
            if budget.planning_version_id:
                planning = PlanningService(self.session, self.user)
                workflow = await planning.ensure_state(budget.id)
                workflow.publication_id = publication.id
                workflow.change_reason = submission_reason
                workflow.requires_resubmission = False
                workflow.return_reason = None
                workflow.confirmed_publication_id = None
                workflow.confirmed_by = None
                workflow.confirmed_at = None
                version = await planning.version(budget.planning_version_id)
                version.revision += 1
        await self.session.commit()
        result = self._publication(publication)
        if budget.planning_version_id:
            result["initiative"]["workflow"] = await PlanningService(
                self.session, self.user
            ).workflow(budget)
        return result

    async def publications(self, budget_id: int) -> list[dict]:
        budget = await self._scoped_budget(budget_id, writable=False, publications=True)
        if self.user.role in {"management", "lead"} and budget.planning_version_id:
            planning = PlanningService(self.session, self.user)
            workflow = await planning.workflow(budget)
            if not workflow["confirmed"] and self.user.role == "management":
                return []
            if not workflow["submitted"]:
                return []
            item = await self.session.get(WorkspacePublicationDO, int(workflow["publicationId"]))
            return [self._publication(item)] if item is not None else []
        if self.user.role == "management" and not budget.planning_version_id:
            exists = await self.session.scalar(
                select(PlanningVersionDO.id)
                .where(PlanningVersionDO.planning_year == budget.planning_year)
                .limit(1)
            )
            if exists:
                return []
        return [
            self._publication(item) for item in await self.repository.publications_for(budget_id)
        ]

    async def _scoped_budget(
        self,
        budget_id: int,
        writable: bool,
        for_update: bool = False,
        publications: bool = False,
    ) -> BudgetDO:
        allowed = {"owner", "lead"}
        if not writable:
            allowed.add("admin")
        if publications:
            allowed.add("management")
        if self.user.role not in allowed:
            raise HTTPException(status_code=403, detail="当前角色不能访问此数据")
        department, sector, owner = self._scope()
        budget = await self.repository.get_scoped_budget(
            budget_id, None, department, sector, owner, False
        )
        if budget is None:
            raise HTTPException(status_code=404, detail="Initiative 不存在或不在当前权限范围")
        planning = PlanningService(self.session, self.user)
        if budget.planning_version_id:
            await planning.read_guard(budget)
        if for_update or budget.planning_version_id:
            # Refresh after obtaining the version lock: ownership may have changed while waiting.
            budget = await self.repository.get_scoped_budget(
                budget_id, None, department, sector, owner, True
            )
            if budget is None:
                raise HTTPException(409, "项目归属或状态已变化，请刷新后重试")
        if budget.planning_version_id:
            await planning.read_guard(budget)
        if writable:
            if (budget.owner_email or "").lower() != self.user.email.lower():
                raise HTTPException(status_code=403, detail="仅当前 Initiative 的 Owner 可编辑")
            await planning.writable(budget)
        return budget

    def _matches(self, budget: BudgetDO) -> bool:
        if self.user.role == "owner":
            return (
                budget.owner_email == self.user.email and budget.department in self.user.departments
            )
        return budget.department in self.user.departments

    def _scope(self) -> tuple[tuple[str, ...] | None, str | None, str | None]:
        if self.user.role == "owner":
            return self.user.departments, None, self.user.email
        if self.user.role == "lead":
            return self.user.departments, None, None
        if self.user.role == "management":
            return None, None, None
        return None, None, None

    def _identity(self) -> dict:
        return {
            "key": self.user.email,
            "email": self.user.email,
            "role": self.user.role,
            "department": list(self.user.departments),
            "sectors": list(self.user.sectors),
            "ownerId": self.user.email,
            "label": self.user.display_name,
            "affiliation_sector": self.user.affiliation_sector,
            "affiliation_department": self.user.affiliation_department,
            "history_resources": self.user.history_resources,
            "preview": {
                "readOnly": True,
                "actorEmail": self.user.preview_actor_email,
                "actorLabel": self.user.preview_actor_label,
            }
            if self.user.preview_actor_email
            else None,
        }

    @staticmethod
    def _budget_projection(
        budget: BudgetDO,
        rows: list,
        other: list,
        publication: WorkspacePublicationDO | None = None,
    ) -> dict:
        revision = budget.revision
        return {
            "id": str(budget.id),
            "planningVersionId": budget.planning_version_id,
            "initiativeKey": budget.initiative_key,
            "enabled": budget.enabled,
            "name": budget.initiative_name,
            "resourceType": budget.resource_type,
            "sector": budget.sector,
            "department": budget.department,
            "ownerId": budget.owner_email,
            "budget": float(budget.plan_budget_amount),
            "rows": [
                {
                    "dealerId": row.history_key or row.distributor_code,
                    "dealerCode": row.distributor_code,
                    "sd": row.sd,
                    "rsm": row.rsm,
                    "amount": float(row.distributor_budget_amount),
                    "note": row.description,
                }
                for row in rows
            ],
            "otherBudgets": [
                {
                    "id": str(row.id),
                    "reasonId": row.reason_id,
                    "amount": float(row.amount),
                    "note": row.note,
                }
                for row in other
            ],
            "revision": revision,
            "publishedRevision": publication.published_revision if publication else None,
            "publishedAt": iso_timestamp(publication.created_at) if publication else None,
            "reserve": float(
                sum((row.amount for row in other if row.reason_id == "reserve"), Decimal("0"))
            ),
            "nonDealer": float(
                sum((row.amount for row in other if row.reason_id != "reserve"), Decimal("0"))
            ),
            "status": "completed" if budget.status == 1 else "draft",
            "savedAt": iso_timestamp(budget.updated_at),
        }

    @staticmethod
    def _publication(item: WorkspacePublicationDO) -> dict:
        initiative = dict(item.snapshot.get("initiative", {}))
        initiative.update(
            status="completed",
            publishedRevision=item.published_revision,
            publishedAt=iso_timestamp(item.created_at),
        )
        return {
            "id": str(item.id),
            "initiativeId": str(item.budget_id),
            "department": item.department,
            "number": item.publication_number,
            "createdAt": iso_timestamp(item.created_at),
            "publishedAt": iso_timestamp(item.created_at),
            "publishedRevision": item.published_revision,
            "initiative": initiative,
            "reference": item.snapshot.get("reference", {}),
            "guideVersion": item.snapshot.get("guideVersion", 0),
            "note": item.note,
        }

    @staticmethod
    def _user(item: UserPermissionDO) -> dict:
        return {
            "email": item.email,
            "label": item.display_name,
            "role": item.role,
            "affiliation_sector": item.affiliation_sector,
            "affiliation_department": item.affiliation_department,
            "history_resources": item.history_resources,
            "department": departments(item.department),
        }

    async def _validate_rows(self, rows: list, other: list, budget: BudgetDO) -> None:
        if budget.planning_version_id and any(
            item.amount != item.amount.to_integral_value() for item in [*rows, *other]
        ):
            raise HTTPException(422, "规划版本的分配和预留必须为非负整数元")
        if len({item.dealerId for item in rows}) != len(rows):
            raise HTTPException(status_code=422, detail="经销商编码不能重复")
        existing = await self.repository.rows_for(budget.id)
        existing_ids = {item.history_key or item.distributor_code for item in existing}
        requested_ids = {item.dealerId for item in rows}
        if budget.planning_version_id:
            await self._validate_version_dealer_scope(budget, requested_ids)
        new_ids = requested_ids - existing_ids
        directory_ids = (
            await self.directory_service.distributor_codes((budget.sector,)) if new_ids else set()
        )
        if not new_ids.issubset(directory_ids):
            raise HTTPException(
                status_code=422, detail="新增经销商必须属于本项目业务线且状态为 active"
            )
        config = await self.repository.config()
        allowed = {
            str(item.get("id"))
            for item in (config.budget_reasons if config else default_budget_reasons())
            if item.get("enabled", True)
        }
        previous = {str(item.id): item for item in await self.repository.other_for(budget.id)}
        for item in other:
            old = previous.get(str(item.id))
            unchanged = (
                old
                and old.reason_id == item.reasonId
                and old.amount == item.amount
                and (old.note or "") == (item.note or "")
            )
            if item.reasonId not in allowed and not unchanged:
                raise HTTPException(
                    status_code=422, detail="其他预算原因不可用；停用原因仅可保留原有行或删除"
                )

    async def _validate_version_dealer_scope(self, budget: BudgetDO, dealer_ids: set[str]) -> None:
        """Recheck the complete roster, retaining existing closed dealers in the same sector."""
        if not dealer_ids:
            return
        from app.core.dealer_identity import dealer_identity
        from app.repositories.reference_repository import ReferenceRepository

        records = await ReferenceRepository(self.session).list_dealers(sectors=(budget.sector,))
        permitted_ids = {dealer_identity(record) for record in records}
        if not dealer_ids.issubset(permitted_ids):
            raise HTTPException(422, "经销商名单包含当前业务线以外或已不存在的经销商，请核对名单")

    @staticmethod
    def _publication_map(publications: list[WorkspacePublicationDO]) -> dict:
        grouped: dict[str, list[dict]] = {}
        for item in publications:
            grouped.setdefault(str(item.budget_id), []).append(WorkspaceService._publication(item))
        return grouped

    @staticmethod
    def _audit(item: BudgetChangeLogDO) -> dict:
        actions = {
            "DRAFT_SAVE": "save_initiative",
            "PUBLISH": "publish_initiative",
            "ADMIN_UPDATE": "import_admin_configuration",
            "ADMIN_CREATE": "set_budget",
            "ADMIN_EDIT": "edit_admin_budget",
            "ADMIN_DELETE": "delete_admin_budget",
            "CONFIG_UPDATE": "set_guide",
            "REFERENCE_IMPORT": "change_reference",
            "USER_CREATE": "create_user",
            "USER_UPDATE": "update_user",
            "USER_DELETE": "delete_user",
            "PROMPT_UPDATE": "set_analysis_prompt",
        }
        return {
            "id": str(item.id),
            "createdAt": iso_timestamp(item.changed_at),
            "actor": {"label": item.operator_id, "role": ""},
            "action": actions.get(item.operation_type, item.operation_type),
            "object": str(item.budget_id) if item.budget_id else "工作台配置",
            "detail": item.operation_note or str(item.after_data or {}),
            "budgetId": str(item.budget_id),
            "operation": item.operation_type,
            "operator": item.operator_id,
            "at": iso_timestamp(item.changed_at),
            "note": item.operation_note,
        }
