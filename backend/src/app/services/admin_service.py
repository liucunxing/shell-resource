from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.budget import BudgetDO
from app.models.do.workspace import (
    UserPermissionDO,
    WorkspaceConfigDO,
    WorkspaceReferenceDO,
)
from app.repositories.admin_repository import AdminRepository
from app.repositories.reference_repository import ReferenceRepository
from app.schemas.dto.workbench import (
    AdminBudgetsCreateDTO,
    AdminBudgetsImportDTO,
    AdminBudgetsUpdateDTO,
    AdminConfigDTO,
    AdminUserDTO,
    ReferenceImportDTO,
)
from app.services.workspace_service import WorkspaceService


class AdminService(WorkspaceService):
    def __init__(self, session: AsyncSession, user: WorkbenchUser) -> None:
        super().__init__(session, user)
        self.admin_repository = AdminRepository(session)
        self.reference_repository = ReferenceRepository(session)

    def _admin(self) -> None:
        if self.user.role != "admin":
            raise HTTPException(status_code=403, detail="仅管理员可维护配置")

    @staticmethod
    def _user_record(item: UserPermissionDO, has_initiatives: bool = False) -> dict:
        return {
            "id": item.id,
            "email": item.email,
            "display_name": item.display_name,
            "role": item.role,
            "department": item.department,
            "sector": list(item.sector or []),
            "enabled": item.enabled,
            "has_initiatives": has_initiatives,
        }

    async def list_users(
        self,
        *,
        email: str | None,
        name: str | None,
        role: str | None,
        department: str | None,
        sector: str | None,
        limit: int,
        offset: int,
    ) -> dict:
        self._admin()
        rows, total = await self.admin_repository.list_users(
            email=email,
            name=name,
            role=role,
            department=department.strip().upper() if department else None,
            sector=sector,
            limit=limit,
            offset=offset,
        )
        return {
            "items": [self._user_record(item, has_budget) for item, has_budget in rows],
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    async def create_user(self, payload: AdminUserDTO) -> dict:
        self._admin()
        try:
            if await self.admin_repository.user_by_email(payload.email):
                raise HTTPException(status_code=409, detail="邮箱已存在")
            user = UserPermissionDO(**payload.model_dump())
            self.admin_repository.add(user)
            await self.session.flush()
            self.repository.add_log(
                0, "USER_CREATE", self.user.email, None,
                self._user_record(user), note=f"新增人员：{user.email}",
            )
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise HTTPException(status_code=409, detail="邮箱已存在") from exc
        except Exception:
            await self.session.rollback()
            raise
        return self._user_record(user)

    async def update_user(self, user_id: int, payload: AdminUserDTO) -> dict:
        self._admin()
        try:
            user = await self.admin_repository.locked_user(user_id)
            if user is None:
                raise HTTPException(status_code=404, detail="人员不存在")
            if await self.admin_repository.user_has_budgets(user.email):
                raise HTTPException(
                    status_code=409,
                    detail="该用户当前已有 Initiative 预算事项，不可修改或删除。",
                )
            duplicate = await self.admin_repository.user_by_email(payload.email)
            if duplicate is not None and duplicate.id != user.id:
                raise HTTPException(status_code=409, detail="邮箱已存在")
            before = self._user_record(user)
            for field, value in payload.model_dump().items():
                setattr(user, field, value)
            after = self._user_record(user)
            if before != after:
                self.repository.add_log(
                    0, "USER_UPDATE", self.user.email, before, after,
                    note=f"修改人员：{before['email']}",
                )
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise HTTPException(status_code=409, detail="邮箱已存在") from exc
        except Exception:
            await self.session.rollback()
            raise
        return self._user_record(user)

    async def delete_user(self, user_id: int) -> dict:
        self._admin()
        try:
            user = await self.admin_repository.locked_user(user_id)
            if user is None:
                raise HTTPException(status_code=404, detail="人员不存在")
            if await self.admin_repository.user_has_budgets(user.email):
                raise HTTPException(
                    status_code=409,
                    detail="该用户当前已有 Initiative 预算事项，不可修改或删除。",
                )
            before = self._user_record(user)
            await self.session.delete(user)
            self.repository.add_log(
                0, "USER_DELETE", self.user.email, before, None,
                note=f"删除人员：{before['email']}",
            )
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        return {"deleted_id": user_id}

    async def _owner(self, email: str, department: str) -> UserPermissionDO:
        owners = await self.admin_repository.owners(email.strip().lower(), department)
        if len(owners) != 1:
            raise HTTPException(status_code=422, detail="Owner 不存在、未启用或部门不匹配")
        return owners[0]

    async def _locked_config(self) -> WorkspaceConfigDO:
        config = await self.admin_repository.locked_config()
        if config is None:
            try:
                async with self.session.begin_nested():
                    config = WorkspaceConfigDO(id=1, revision=0)
                    self.admin_repository.add(config)
                    await self.session.flush()
            except IntegrityError:
                config = await self.admin_repository.locked_config()
        if config is None:
            raise HTTPException(status_code=409, detail="配置初始化冲突，请重试")
        return config

    async def update_budgets(self, payload: AdminBudgetsUpdateDTO) -> dict:
        self._admin()
        if len({item.id for item in payload.items}) != len(payload.items):
            raise HTTPException(status_code=422, detail="预算 ID 不可重复")
        try:
            budgets = []
            for item in sorted(payload.items, key=lambda item: item.id):
                budget = await self.admin_repository.locked_budget(item.id)
                if budget is None:
                    raise HTTPException(status_code=422, detail="预算不存在")
                owner = await self._owner(item.ownerId, budget.department)
                if budget.revision != item.expected_revision:
                    raise HTTPException(status_code=409, detail="预算已被修改，请刷新后重试")
                budgets.append((budget, item, owner))
            updated = 0
            for budget, item, owner in budgets:
                if budget.plan_budget_amount == item.budget and budget.owner_email == owner.email:
                    continue
                before = {"budget": float(budget.plan_budget_amount), "ownerId": budget.owner_email}
                budget.plan_budget_amount = item.budget
                budget.owner_email = owner.email
                budget.revision += 1
                budget.status = 0
                updated += 1
                self.repository.add_log(
                    budget.id,
                    "ADMIN_UPDATE",
                    self.user.email,
                    before,
                    {"budget": float(item.budget), "ownerId": owner.email},
                )
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        return {"updated_count": updated}

    async def create_budgets(self, payload: AdminBudgetsCreateDTO) -> dict:
        self._admin()
        try:
            # A single configuration row serializes this small admin batch.
            await self._locked_config()
            entities = []
            keys = set()
            for item in payload.items:
                key = (item.sector, item.department, item.resourceType, item.name)
                if key in keys or await self.admin_repository.business_key_exists(
                    payload.planning_year,
                    item.sector,
                    item.department,
                    item.resourceType,
                    item.name,
                ):
                    raise HTTPException(
                        status_code=409,
                        detail="同年度、部门、Sector 和资源类型下 Initiative 已存在",
                    )
                keys.add(key)
                if item.resourceType not in {
                    "MKT": {"MRD", "SP&A"},
                    "ICE": {"ICE Rebate"},
                    "CAPEX": {"Capex"},
                }.get(item.department, set()):
                    raise HTTPException(status_code=422, detail="资源类型与部门不匹配")
                owner = await self._owner(item.ownerId, item.department)
                entities.append(
                    BudgetDO(
                        planning_year=payload.planning_year,
                        sector=item.sector,
                        department=item.department,
                        resource_type=item.resourceType,
                        initiative_name=item.name,
                        plan_budget_amount=item.budget,
                        allocate_budget_amount=0,
                        status=0,
                        input_source="ADMIN",
                        owner_email=owner.email,
                        revision=0,
                    )
                )
            self.admin_repository.add_budgets(entities)
            await self.session.flush()
            for budget in entities:
                self.repository.add_log(
                    budget.id,
                    "ADMIN_CREATE",
                    self.user.email,
                    None,
                    {"budget": float(budget.plan_budget_amount), "ownerId": budget.owner_email},
                )
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        return {"created_count": len(entities)}

    async def import_budgets(self, payload: AdminBudgetsImportDTO) -> dict:
        """Validate and apply mixed create/update rows in one transaction."""
        self._admin()
        try:
            # Serialize mixed imports so business-key checks and inserts remain atomic.
            await self._locked_config()
            updates = []
            for item in sorted(payload.updates, key=lambda value: value.id):
                budget = await self.admin_repository.locked_budget(item.id)
                if budget is None:
                    raise HTTPException(status_code=422, detail="预算不存在")
                if budget.planning_year != payload.planning_year:
                    raise HTTPException(status_code=422, detail="预算不属于当前规划年度")
                owner = await self._owner(item.ownerId, budget.department)
                if budget.revision != item.expected_revision:
                    raise HTTPException(status_code=409, detail="预算已被修改，请刷新后重试")
                updates.append((budget, item, owner))

            entities = []
            keys = set()
            allowed_resources = {
                "MKT": {"MRD", "SP&A"},
                "ICE": {"ICE Rebate"},
                "CAPEX": {"Capex"},
            }
            for item in payload.creates:
                key = (item.sector, item.department, item.resourceType, item.name)
                if key in keys or await self.admin_repository.business_key_exists(
                    payload.planning_year,
                    item.sector,
                    item.department,
                    item.resourceType,
                    item.name,
                ):
                    raise HTTPException(
                        status_code=409,
                        detail="同年度、部门、Sector 和资源类型下 Initiative 已存在",
                    )
                keys.add(key)
                if item.resourceType not in allowed_resources.get(item.department, set()):
                    raise HTTPException(status_code=422, detail="资源类型与部门不匹配")
                owner = await self._owner(item.ownerId, item.department)
                entities.append(
                    BudgetDO(
                        planning_year=payload.planning_year,
                        sector=item.sector,
                        department=item.department,
                        resource_type=item.resourceType,
                        initiative_name=item.name,
                        plan_budget_amount=item.budget,
                        allocate_budget_amount=0,
                        status=0,
                        input_source="ADMIN_IMPORT",
                        owner_email=owner.email,
                        revision=0,
                    )
                )

            updated = 0
            for budget, item, owner in updates:
                if budget.plan_budget_amount == item.budget and budget.owner_email == owner.email:
                    continue
                before = {"budget": float(budget.plan_budget_amount), "ownerId": budget.owner_email}
                budget.plan_budget_amount = item.budget
                budget.owner_email = owner.email
                budget.revision += 1
                budget.status = 0
                updated += 1
                self.repository.add_log(
                    budget.id,
                    "ADMIN_UPDATE",
                    self.user.email,
                    before,
                    {"budget": float(item.budget), "ownerId": owner.email},
                )

            self.admin_repository.add_budgets(entities)
            await self.session.flush()
            for budget in entities:
                self.repository.add_log(
                    budget.id,
                    "ADMIN_CREATE",
                    self.user.email,
                    None,
                    {"budget": float(budget.plan_budget_amount), "ownerId": budget.owner_email},
                )
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        return {"updated_count": updated, "created_count": len(entities)}

    async def update_config(self, payload: AdminConfigDTO) -> dict:
        self._admin()
        try:
            config = await self._locked_config()
            if config.revision != payload.expected_revision:
                raise HTTPException(status_code=409, detail="配置已被修改，请刷新后重试")
            if payload.budgetReasons is not None:
                ids = [reason["id"] for reason in payload.budgetReasons]
                if await self.admin_repository.has_removed_reason_in_use(ids):
                    raise HTTPException(status_code=422, detail="仍被预算行使用的原因不能删除")
                config.budget_reasons = payload.budgetReasons
                config.budget_reason_version += 1
            if payload.guide is not None:
                config.guide = {
                    "text": payload.guide["text"],
                    "version": config.guide.get("version", 0) + 1,
                }
            config.revision += 1
            result = {
                "revision": config.revision,
                "budgetReasons": config.budget_reasons,
                "budgetReasonVersion": config.budget_reason_version,
                "guide": config.guide,
                "reference": config.reference,
            }
            self.repository.add_log(
                0, "CONFIG_UPDATE", self.user.email, None, {"revision": config.revision}
            )
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        return result

    async def import_reference(self, payload: ReferenceImportDTO) -> dict:
        self._admin()
        try:
            config = await self._locked_config()
            if config.revision != payload.expected_revision:
                raise HTTPException(status_code=409, detail="配置已被修改，请刷新后重试")
            await self.reference_repository.clear_year(payload.planning_year)
            for dealer in payload.dealers:
                history = dealer.history
                resources = history.get("resources2025", {})
                self.reference_repository.add(
                    WorkspaceReferenceDO(
                        planning_year=payload.planning_year,
                        batch_id=payload.batchId,
                        as_of=payload.asOf,
                        dealer_id=dealer.id,
                        dealer_name=dealer.name,
                        vol2024=history.get("vol2024"),
                        c32024=history.get("c32024"),
                        vol2025=history.get("vol2025"),
                        c32025=history.get("c32025"),
                        vol2026_ytd=history.get("vol2026Ytd"),
                        c32026_ytd=history.get("c32026Ytd"),
                        mrd2025=resources.get("MRD"),
                        spa2025=resources.get("SP&A"),
                        ice2025=resources.get("ICE Rebate"),
                        capex2025=resources.get("Capex"),
                    )
                )
            config.reference = {
                "batchId": payload.batchId,
                "asOf": payload.asOf,
                "importedAt": datetime.now(UTC).isoformat(),
                "planningYear": payload.planning_year,
                "count": len(payload.dealers),
            }
            config.revision += 1
            self.repository.add_log(0, "REFERENCE_IMPORT", self.user.email, None, config.reference)
            result = {**config.reference, "revision": config.revision}
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            raise
        return result
