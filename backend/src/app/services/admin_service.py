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
    AdminBudgetsUpdateDTO,
    AdminConfigDTO,
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

    async def _owner(self, email: str, department: str, sector: str) -> UserPermissionDO:
        owners = await self.admin_repository.owners(email.strip().lower(), department)
        if len(owners) != 1 or (owners[0].sector and owners[0].sector != sector):
            raise HTTPException(status_code=422, detail="Owner 不存在、未启用或部门/Sector 不匹配")
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
                owner = await self._owner(item.ownerId, budget.department, budget.sector)
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
                owner = await self._owner(item.ownerId, item.department, item.sector)
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
