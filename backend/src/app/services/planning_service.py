"""Versioned planning, immutable submissions and atomic department decisions."""

from copy import deepcopy
from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timestamps import iso_timestamp
from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.budget import BudgetDO
from app.models.do.planning import InitiativeWorkflowDO, PlanningVersionDO
from app.models.do.workspace import WorkspacePublicationDO
from app.repositories.workspace_repository import WorkspaceRepository
from app.schemas.dto.planning import (
    DepartmentActionDTO,
    PlanningVersionCreateDTO,
    PlanningVersionDeleteDTO,
    PlanningVersionUpdateDTO,
    VersionInitiativeDTO,
    VersionInitiativesImportDTO,
)


def utc_now() -> datetime:
    return datetime.now(UTC)


def deadline_passed(version: PlanningVersionDO) -> bool:
    deadline = version.deadline
    if deadline is not None and deadline.tzinfo is None:
        deadline = deadline.replace(tzinfo=UTC)
    return deadline is not None and deadline <= utc_now()


def version_view(version: PlanningVersionDO) -> dict:
    return {
        "id": version.id,
        "name": version.name,
        "createdBy": version.created_by,
        "planningYear": version.planning_year,
        "sourceVersionId": version.source_version_id,
        "published": version.published,
        "open": version.open,
        "deadline": iso_timestamp(version.deadline),
        "revision": version.revision,
        "expired": deadline_passed(version),
    }


class PlanningService:
    def __init__(self, session: AsyncSession, user: WorkbenchUser) -> None:
        self.session, self.user = session, user
        self.repository = WorkspaceRepository(session)

    def admin(self) -> None:
        if self.user.role != "admin" or self.user.preview_actor_email:
            raise HTTPException(403, "仅管理员可以配置规划版本")

    async def versions(self, year: int) -> list[PlanningVersionDO]:
        query = select(PlanningVersionDO).where(
            PlanningVersionDO.planning_year == year, PlanningVersionDO.deleted_at.is_(None)
        )
        if self.user.role != "admin":
            query = query.where(PlanningVersionDO.published.is_(True))
        return list(
            (
                await self.session.scalars(
                    query.order_by(PlanningVersionDO.created_at.desc(), PlanningVersionDO.id.desc())
                )
            ).all()
        )

    async def version(self, version_id: str, *, lock: bool = False) -> PlanningVersionDO:
        query = select(PlanningVersionDO).where(
            PlanningVersionDO.id == version_id, PlanningVersionDO.deleted_at.is_(None)
        )
        if lock:
            query = query.with_for_update().execution_options(populate_existing=True)
        version = await self.session.scalar(query)
        if version is None or (not version.published and self.user.role != "admin"):
            raise HTTPException(404, "规划版本不存在或尚未发布")
        return version

    async def resolve(self, year: int, version_id: str | None = None) -> PlanningVersionDO | None:
        if version_id:
            version = await self.version(version_id)
            if version.planning_year != year:
                raise HTTPException(422, "规划版本不属于所选年度")
            return version
        versions = await self.versions(year)
        if versions:
            return next((v for v in versions if v.open), versions[0])
        exists = await self.session.scalar(
            select(PlanningVersionDO.id).where(PlanningVersionDO.planning_year == year).limit(1)
        )
        if exists and self.user.role != "admin":
            raise HTTPException(409, "本年度版本尚未发布，请联系管理员")
        return None

    async def state(self, budget_id: int) -> InitiativeWorkflowDO | None:
        return await self.session.get(InitiativeWorkflowDO, budget_id)

    async def ensure_state(self, budget_id: int) -> InitiativeWorkflowDO:
        state = await self.state(budget_id)
        if state is None:
            state = InitiativeWorkflowDO(
                budget_id=budget_id, requires_resubmission=False, change_reason=""
            )
            self.session.add(state)
            await self.session.flush()
        return state

    def permitted(self, budget: BudgetDO) -> bool:
        if self.user.role in {"admin", "management"}:
            return True
        return (
            budget.department in self.user.departments
            and budget.sector in self.user.sectors
            and (
                self.user.role != "owner"
                or (budget.owner_email or "").lower() == self.user.email.lower()
            )
        )

    async def read_guard(self, budget: BudgetDO) -> PlanningVersionDO | None:
        if not self.permitted(budget):
            raise HTTPException(404, "Initiative 不在当前授权范围")
        if budget.planning_version_id:
            return await self.version(budget.planning_version_id, lock=True)
        return None

    async def writable(self, budget: BudgetDO) -> PlanningVersionDO | None:
        if not budget.planning_version_id:
            return None
        if self.user.preview_actor_email or not self.permitted(budget):
            raise HTTPException(403, "当前身份不能修改此项目")
        version = await self.version(budget.planning_version_id, lock=True)
        if (
            not version.published
            or not version.open
            or deadline_passed(version)
            or not budget.enabled
        ):
            raise HTTPException(409, "当前版本未开放、已截止或项目已取消，请联系管理员")
        state = await self.state(budget.id)
        if state and (state.owner_edit_locked or state.confirmed_publication_id):
            raise HTTPException(409, "方案已由部门确认，须部门负责人退回所选项目后才能修改")
        return version

    async def workflow(self, budget: BudgetDO, version: PlanningVersionDO | None = None) -> dict:
        state = await self.state(budget.id)
        publication = (
            await self.session.get(WorkspacePublicationDO, state.publication_id)
            if state and state.publication_id
            else None
        )
        if version is None and budget.planning_version_id:
            version = await self.version(budget.planning_version_id)
        submitted = bool(publication and state and not state.requires_resubmission
                         and publication.published_revision == budget.revision)
        confirmed = bool(
            submitted and state and state.confirmed_publication_id == state.publication_id
        )
        return {
            "submitted": submitted,
            "confirmed": confirmed,
            "requiresResubmission": bool(state and state.requires_resubmission),
            "ownerEditLocked": bool(state and state.owner_edit_locked),
            "returnReason": state.return_reason if state else None,
            "publicationId": str(publication.id) if publication else None,
            "submittedRevision": publication.published_revision if publication else None,
            "submittedAt": iso_timestamp(publication.created_at) if publication else None,
            "confirmedAt": iso_timestamp(state.confirmed_at) if state else None,
            "confirmedBy": state.confirmed_by if state else None,
            "editable": bool(
                version
                and version.published
                and version.open
                and not deadline_passed(version)
                and budget.enabled
                and not (state and (state.owner_edit_locked or state.confirmed_publication_id))
                and self.user.role in {"owner", "lead"}
                and (budget.owner_email or "").lower() == self.user.email.lower()
                and not self.user.preview_actor_email
            ),
            "changeReason": state.change_reason if state else "",
        }

    async def create(self, payload: PlanningVersionCreateDTO) -> dict:
        self.admin()
        # Existing config row serializes version creation and publish/open operations.
        from app.services.admin_service import AdminService

        await AdminService(self.session, self.user)._locked_config()
        if await self.session.get(PlanningVersionDO, payload.id):
            raise HTTPException(409, "规划版本号已存在")
        source = None
        if payload.source_version_id:
            source = await self.version(payload.source_version_id, lock=True)
            if source.planning_year != payload.planning_year:
                raise HTTPException(422, "复制来源必须属于同一规划年度")
            if not source.published or payload.id <= source.id:
                raise HTTPException(422, "新版本须晚于所选已发布来源版本")
        elif await self.session.scalar(
            select(PlanningVersionDO.id)
            .where(
                PlanningVersionDO.planning_year == payload.planning_year,
                PlanningVersionDO.deleted_at.is_(None),
            )
            .limit(1)
        ):
            raise HTTPException(422, "已有规划版本，请明确选择复制来源")
        query = (
            select(BudgetDO)
            .where(
                BudgetDO.planning_year == payload.planning_year,
                BudgetDO.planning_version_id == (source.id if source else None),
            )
            .order_by(BudgetDO.id)
        )
        originals = list((await self.session.scalars(query.with_for_update())).all())
        copies = []
        for original in originals:
            history = await self.repository.publications_for(original.id)
            # Copy only the last submitted snapshot, including a returned submission.
            snapshot = deepcopy(history[-1].snapshot.get("initiative", {})) if history else {}
            await self._normalize_legacy_copy_rows(original, snapshot.get("rows", []))
            copies.append((original, snapshot))
        version = PlanningVersionDO(
            id=payload.id,
            name=payload.name,
            planning_year=payload.planning_year,
            source_version_id=payload.source_version_id,
            deadline=payload.deadline,
            published=False,
            open=False,
            revision=0,
            created_by=self.user.email,
        )
        self.session.add(version)
        await self.session.flush()
        for original, snapshot in copies:
            budget = BudgetDO(
                planning_year=original.planning_year,
                planning_version_id=version.id,
                initiative_key=original.initiative_key or str(original.id),
                enabled=original.enabled,
                sector=original.sector,
                department=original.department,
                resource_type=original.resource_type,
                initiative_name=original.initiative_name,
                owner_email=original.owner_email,
                plan_budget_amount=original.plan_budget_amount,
                allocate_budget_amount=0,
                revision=0,
                status=0,
                input_source="VERSION_COPY",
            )
            self.session.add(budget)
            await self.session.flush()
            rows, other = snapshot.get("rows", []), snapshot.get("otherBudgets", [])
            await self.repository.replace_rows(budget, rows)
            await self.repository.replace_other(budget.id, other)
            budget.allocate_budget_amount = sum(
                (Decimal(str(r["amount"])) for r in rows + other), Decimal(0)
            )
            await self.ensure_state(budget.id)
        self.repository.add_log(
            0,
            "VERSION_CREATE",
            self.user.email,
            None,
            version_view(version),
            "从最后已提交快照建立独立草稿；提交和确认状态不继承",
        )
        await self.session.commit()
        return version_view(version)

    async def _normalize_legacy_copy_rows(self, budget: BudgetDO, rows: list[dict]) -> None:
        """Resolve plain legacy codes only in the detached copy, never in source snapshots."""
        from app.core.dealer_identity import dealer_identity
        from app.repositories.reference_repository import ReferenceRepository

        legacy_rows = [row for row in rows if not row["dealerId"].startswith("history:")]
        if not legacy_rows:
            return
        records = await ReferenceRepository(self.session).list_dealers(
            list({row["dealerId"] for row in legacy_rows}), (budget.sector,)
        )
        identities: dict[str, set[str]] = {}
        for record in records:
            identities.setdefault(str(record["distributor_code"]), set()).add(
                dealer_identity(record)
            )
        for row in legacy_rows:
            candidates = identities.get(row["dealerId"], set())
            if len(candidates) > 1:
                raise HTTPException(
                    422,
                    f"项目“{budget.initiative_name}”的旧经销商编码“{row['dealerId']}”"
                    f"在 {budget.sector} 对应多个 SD/RSM，请先在来源方案中重新选择并提交，"
                    "再创建版本",
                )
            if len(candidates) == 1:
                row["dealerId"] = next(iter(candidates))
        if len({row["dealerId"] for row in rows}) != len(rows):
            raise HTTPException(
                422,
                f"项目“{budget.initiative_name}”的旧编码与组织身份指向同一经销商，"
                "请先在来源方案中重新选择名单并提交，再创建版本",
            )

    async def update(self, version_id: str, payload: PlanningVersionUpdateDTO) -> dict:
        self.admin()
        from app.services.admin_service import AdminService

        await AdminService(self.session, self.user)._locked_config()
        version = await self.version(version_id, lock=True)
        self.check_revision(version, payload.expected_revision)
        before = version_view(version)
        if "name" in payload.model_fields_set:
            if payload.name is None:
                raise HTTPException(422, "版本名称不能为空")
            version.name = payload.name
        if "id" in payload.model_fields_set:
            if payload.id is None:
                raise HTTPException(422, "版本编码不能为空")
            if payload.id != version_id:
                if await self.session.get(PlanningVersionDO, payload.id):
                    raise HTTPException(409, "版本编码已存在或已被历史版本使用")
                await self.session.execute(update(BudgetDO).where(
                    BudgetDO.planning_version_id == version_id
                ).values(planning_version_id=payload.id))
                await self.session.execute(update(PlanningVersionDO).where(
                    PlanningVersionDO.source_version_id == version_id
                ).values(source_version_id=payload.id, revision=PlanningVersionDO.revision + 1))
                version.id = payload.id
        if payload.published is True or payload.open is True:
            budgets = await self.session.scalars(
                select(BudgetDO).where(
                    BudgetDO.planning_version_id == version.id, BudgetDO.enabled.is_(True)
                )
            )
            if any(
                budget.plan_budget_amount < 0
                or budget.plan_budget_amount != budget.plan_budget_amount.to_integral_value()
                for budget in budgets
            ):
                raise HTTPException(
                    422, "当前版本包含非整数预算，请在本版项目配置修正为非负整数元后再发布或开放"
                )
        for name in ("published", "open", "deadline"):
            if name in payload.model_fields_set:
                if name != "deadline" and getattr(payload, name) is None:
                    raise HTTPException(422, "发布与开放状态不能为 null")
                setattr(version, name, getattr(payload, name))
        if version.open and (not version.published or deadline_passed(version)):
            raise HTTPException(422, "仅已发布且未截止的版本可以开放")
        if version.open:
            others = list(
                (
                    await self.session.scalars(
                        select(PlanningVersionDO)
                        .where(
                            PlanningVersionDO.planning_year == version.planning_year,
                            PlanningVersionDO.id != version.id,
                            PlanningVersionDO.deleted_at.is_(None),
                            PlanningVersionDO.open.is_(True),
                        )
                        .with_for_update()
                    )
                ).all()
            )
            for other in others:
                other.open = False
                other.revision += 1
        version.revision += 1
        self.repository.add_log(0, "VERSION_UPDATE", self.user.email, before, version_view(version))
        await self.session.commit()
        return version_view(version)

    async def deletion_info(self, version_id: str) -> dict:
        self.admin()
        version = await self.version(version_id)
        count = await self.session.scalar(
            select(func.count(WorkspacePublicationDO.id)).where(
                WorkspacePublicationDO.budget_id.in_(
                    select(BudgetDO.id).where(BudgetDO.planning_version_id == version_id)
                )
            )
        )
        return {"revision": version.revision, "submittedCount": count or 0,
                "canDelete": not version.open or not version.published}

    async def delete(self, version_id: str, payload: PlanningVersionDeleteDTO) -> dict:
        self.admin()
        from app.services.admin_service import AdminService

        await AdminService(self.session, self.user)._locked_config()
        version = await self.version(version_id, lock=True)
        self.check_revision(version, payload.expected_revision)
        if version.published and version.open:
            raise HTTPException(409, "请先关闭提交，再删除规划版本")
        info = await self.deletion_info(version_id)
        if info["submittedCount"] and not payload.confirm_submitted:
            raise HTTPException(409, "该版本存在已提交内容，请勾选确认后再次确认删除")
        before = version_view(version)
        version.open = False
        version.published = False
        version.deleted_at = utc_now()
        version.revision += 1
        self.repository.add_log(0, "VERSION_DELETE", self.user.email, before,
                                {"submittedCount": info["submittedCount"]},
                                "删除版本，历史数据保留供审计")
        await self.session.commit()
        return {"id": version_id, "deleted": True}

    @staticmethod
    def check_revision(version: PlanningVersionDO, expected: int) -> None:
        if version.revision != expected:
            raise HTTPException(409, "版本内容或提交状态已变化，请刷新后重试")

    def department_authorized(self, sector: str, department: str, *, mutate: bool) -> None:
        if self.user.role == "admin":
            return
        if (
            self.user.role != "lead"
            or sector not in self.user.sectors
            or department not in self.user.departments
            or (mutate and self.user.preview_actor_email)
        ):
            raise HTTPException(403, "无权操作当前部门方案")

    async def department_budgets(
        self, version_id: str, sector: str, department: str
    ) -> list[BudgetDO]:
        return list(
            (
                await self.session.scalars(
                    select(BudgetDO)
                    .where(
                        BudgetDO.planning_version_id == version_id,
                        BudgetDO.sector == sector,
                        BudgetDO.department == department,
                        BudgetDO.enabled.is_(True),
                    )
                    .order_by(BudgetDO.id)
                )
            ).all()
        )

    async def department(self, version_id: str, sector: str, department: str) -> dict:
        self.department_authorized(sector, department, mutate=False)
        version = await self.version(version_id, lock=True)
        budgets = await self.department_budgets(version_id, sector, department)
        from app.services.workspace_service import WorkspaceService

        workspace = WorkspaceService(self.session, self.user)
        items = []
        for budget in budgets:
            state = await self.state(budget.id)
            publication = (
                await self.session.get(WorkspacePublicationDO, state.publication_id)
                if state and state.publication_id
                else None
            )
            item = WorkspaceService._budget_projection(budget, [], [])
            if publication:
                item.update(workspace._publication(publication)["initiative"])
            item["workflow"] = await self.workflow(budget, version)
            item["ownerLabel"] = budget.owner_email
            item["allocationVisible"] = bool(publication)
            items.append(item)
        submitted = sum(i["workflow"]["submitted"] for i in items)
        confirmed = sum(i["workflow"]["confirmed"] for i in items)
        return {
            "version": version_view(version),
            "sector": sector,
            "department": department,
            "items": items,
            "total": len(items),
            "submitted": submitted,
            "confirmed": confirmed,
            "canConfirm": bool(
                items and submitted == len(items) and confirmed < len(items) and version.published
            ),
        }

    async def department_action(
        self, version_id: str, action: str, payload: DepartmentActionDTO
    ) -> dict:
        self.department_authorized(payload.sector, payload.department, mutate=True)
        version = await self.version(version_id, lock=True)
        self.check_revision(version, payload.expected_revision)
        budgets = await self.department_budgets(version_id, payload.sector, payload.department)
        states = [(b, await self.ensure_state(b.id)) for b in budgets]
        if not states:
            raise HTTPException(422, "当前部门没有启用项目")
        if action != "return" and (payload.initiative_id or payload.owner_email):
            raise HTTPException(422, "部门确认和撤回必须针对整个部门")
        if action == "confirm":
            if not version.published or any([
                not (await self.workflow(b, version))["submitted"] for b, _ in states
            ]):
                raise HTTPException(409, "所有启用项目提交齐全后才能统一确认")
            for _, state in states:
                state.owner_edit_locked = True
                state.confirmed_publication_id = state.publication_id
                state.confirmed_by = self.user.email
                state.confirmed_at = utc_now()
        elif action == "withdraw":
            if not payload.reason:
                raise HTTPException(422, "请填写撤回原因")
            if not any(s.confirmed_publication_id for _, s in states):
                raise HTTPException(409, "当前部门尚未确认")
            for _, state in states:
                state.confirmed_publication_id = None
                state.confirmed_by = None
                state.confirmed_at = None
        elif action == "return":
            if not payload.reason:
                raise HTTPException(422, "请填写退回原因")
            if any(s.confirmed_publication_id for _, s in states):
                raise HTTPException(409, "请先撤回部门确认")
            states = [
                (b, s)
                for b, s in states
                if s.publication_id
                and s.owner_edit_locked
                and not s.requires_resubmission
                and (not payload.initiative_id or b.id == payload.initiative_id)
                and (
                    not payload.owner_email
                    or (b.owner_email or "").lower() == payload.owner_email.lower()
                )
            ]
            if not states:
                raise HTTPException(422, "所选范围没有已锁定且可退回的已提交项目")
            for budget, state in states:
                state.owner_edit_locked = False
                state.requires_resubmission = True
                state.return_reason = payload.reason
                budget.status = 0
        else:
            raise HTTPException(404, "未知部门操作")
        for budget, state in states:
            self.repository.add_log(
                budget.id,
                "DEPARTMENT_" + action.upper(),
                self.user.email,
                None,
                {"versionId": version.id, "publicationId": state.publication_id},
                payload.reason,
            )
        version.revision += 1
        await self.session.commit()
        return await self.department(version_id, payload.sector, payload.department)

    async def edit_initiative(
        self, version_id: str, budget_id: int | None, payload: VersionInitiativeDTO,
        *, commit: bool = True,
    ) -> dict:
        self.admin()
        version = await self.version(version_id, lock=True)
        self.check_revision(version, payload.expected_revision)
        from app.services.admin_service import AdminService

        owner = await AdminService(self.session, self.user)._owner(
            payload.ownerId, payload.department
        )
        if payload.sector not in (owner.sector or []):
            raise HTTPException(422, "Owner 未获授权当前业务线")
        budget = await self.session.get(BudgetDO, budget_id) if budget_id else None
        if budget_id and (budget is None or budget.planning_version_id != version_id):
            raise HTTPException(404, "项目不存在于当前版本")
        if budget and budget.sector != payload.sector and await self.repository.rows_for(budget.id):
            raise HTTPException(
                422,
                "项目已有经销商名单（包括零金额行），不能切换业务线。"
                "请先在原业务线退回 Owner，由 Owner 清空名单并保存后再修改业务线",
            )
        duplicate = await self.session.scalar(
            select(BudgetDO.id).where(
                BudgetDO.planning_version_id == version_id,
                BudgetDO.sector == payload.sector,
                BudgetDO.department == payload.department,
                BudgetDO.initiative_name == payload.name,
                BudgetDO.resource_type == payload.resourceType,
                BudgetDO.id != (budget_id or 0),
            )
        )
        if duplicate:
            raise HTTPException(409, "当前版本已存在同名项目")
        previous_scope = (budget.sector, budget.department) if budget else None
        if budget is None:
            budget = BudgetDO(
                planning_version_id=version_id,
                initiative_key=uuid4().hex,
                planning_year=version.planning_year,
                revision=0,
                allocate_budget_amount=0,
                status=0,
                input_source="VERSION_ADMIN",
            )
            self.session.add(budget)
        budget.initiative_name, budget.resource_type = payload.name, payload.resourceType
        budget.sector, budget.department, budget.owner_email = (
            payload.sector,
            payload.department,
            owner.email,
        )
        budget.plan_budget_amount, budget.enabled = payload.budget, payload.enabled
        budget.revision = (budget.revision or 0) + 1
        budget.status = 0
        await self.session.flush()
        from app.repositories.admin_repository import AdminRepository

        await AdminRepository(self.session).sync_allocation_metadata(budget)
        state = await self.ensure_state(budget.id)
        if state.publication_id:
            state.requires_resubmission = True
            state.return_reason = payload.reason
        affected_scopes = {(budget.sector, budget.department)}
        if previous_scope is not None:
            affected_scopes.add(previous_scope)
        for sector, department in affected_scopes:
            for other in await self.department_budgets(version_id, sector, department):
                other_state = await self.ensure_state(other.id)
                other_state.confirmed_publication_id = None
                other_state.confirmed_by = None
                other_state.confirmed_at = None
        # Also clear confirmation on a now-disabled project.
        state.confirmed_publication_id = None
        state.confirmed_by = None
        state.confirmed_at = None
        version.published, version.open = False, False
        version.revision += 1
        self.repository.add_log(
            budget.id,
            "VERSION_INITIATIVE_EDIT",
            self.user.email,
            None,
            {"versionId": version_id, "enabled": budget.enabled},
            payload.reason,
        )
        if commit:
            await self.session.commit()
        return {"id": str(budget.id), "version": version_view(version)}


    async def import_initiatives(
        self, version_id: str, payload: VersionInitiativesImportDTO,
    ) -> dict:
        self.admin()
        if self.user.preview_actor_email:
            raise HTTPException(403, "模拟用户视角仅供查看")
        try:
            version = await self.version(version_id, lock=True)
            self.check_revision(version, payload.expected_revision)
            original_version = version_view(version)
            results = []
            for index, item in enumerate(payload.items, 2):
                command = VersionInitiativeDTO(**{
                    **item.model_dump(exclude={"id", "expected_revision"}),
                    "expected_revision": version.revision,
                })
                try:
                    results.append(await self.edit_initiative(
                        version_id, item.id, command, commit=False,
                    ))
                except HTTPException as exc:
                    raise HTTPException(exc.status_code, f"第 {index} 行：{exc.detail}") from exc
            result = {"total": len(results), "items": results,
                      "version": original_version if payload.preview else version_view(version)}
            if payload.preview:
                await self.session.rollback()
            else:
                await self.session.commit()
            return result
        except Exception:
            await self.session.rollback()
            raise
