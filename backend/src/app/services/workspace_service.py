from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.budget import BudgetDO
from app.models.do.workspace import (
    BudgetChangeLogDO,
    UserPermissionDO,
    WorkspacePublicationDO,
    default_budget_reasons,
)
from app.repositories.workspace_repository import WorkspaceRepository
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO, PublishDTO
from app.services.reference_service import ReferenceService


class WorkspaceService:
    """V1.4 draft and publication operations. Values are Decimal until projection."""

    def __init__(self, session: AsyncSession, user: WorkbenchUser) -> None:
        self.session = session
        self.user = user
        self.repository = WorkspaceRepository(session)

    async def get_workspace(self, planning_year: int) -> dict:
        department, sector, owner = self._scope()
        config = await self.repository.config()
        users = await self.repository.list_users() if self.user.role == "admin" else []
        if self.user.role == "management":
            publications = await self.repository.latest_publications(
                planning_year, department, sector, owner
            )
            initiatives = [self._publication(item)["initiative"] for item in publications]
        elif self.user.role == "admin":
            initiatives = [
                self._budget_projection(item, [], [])
                for item in await self.repository.list_budgets(planning_year, None, None, None)
            ]
            publications = []
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
        dealer_ids = [row["dealerId"] for item in initiatives for row in item.get("rows", [])]
        dealers = []
        if self.user.role in {"owner", "lead", "management"}:
            dealers = await ReferenceService(self.session).get_dealers(
                planning_year, self.user.department, dealer_ids
            )
        if self.user.role in {"owner", "lead"}:
            # The picker needs the approved directory even for an empty draft.
            # Names/codes are shared; detailed history remains allocation-scoped.
            visible_ids = {item["id"] for item in dealers}
            for item in await self.repository.references(planning_year):
                if item.dealer_id not in visible_ids:
                    dealers.append({"id": item.dealer_id, "name": item.dealer_name, "history": {}})
        audit = []
        if self.user.role != "management":
            audit = [
                self._audit(item)
                for item in await self.repository.logs_for(
                    budget_ids, admin=self.user.role == "admin"
                )
            ]
        state = {
            "schemaVersion": 2,
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
            "reference": await self._reference_metadata(planning_year),
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
                "initiatives": initiatives,
                "allocations": [],
                "dealers": dealers,
            },
            "users": [self._user(item) for item in users],
        }

    async def _reference_metadata(self, planning_year: int) -> dict:
        rows = await self.repository.references(planning_year)
        if not rows:
            return {}
        result = {
            "batchId": rows[0].batch_id,
            "asOf": rows[0].as_of,
            "planningYear": planning_year,
            "count": len(rows),
        }
        config = await self.repository.config()
        if config and config.reference.get("planningYear") == planning_year:
            imported_at = config.reference.get("importedAt")
            if imported_at:
                result["importedAt"] = imported_at
        return result

    async def get_draft(self, budget_id: int) -> dict:
        budget = await self._scoped_budget(budget_id, writable=False)
        history = await self.repository.publications_for(budget_id)
        return self._budget_projection(
            budget,
            await self.repository.rows_for(budget.id),
            await self.repository.other_for(budget.id),
            history[-1] if history else None,
        )

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
        total = sum((item.distributor_budget_amount for item in rows), Decimal("0")) + sum(
            (item.amount for item in other), Decimal("0")
        )
        if total != budget.plan_budget_amount:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="同步前经销商及其他预算之和必须等于总预算",
            )
        if any(item.amount and not (item.note or "").strip() for item in other):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="非零其他预算必须填写说明"
            )
        old = await self.repository.publications_for(budget_id)
        initiative = self._budget_projection(budget, rows, other)
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
                note=payload.note or None,
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
        await self.session.commit()
        return self._publication(publication)

    async def publications(self, budget_id: int) -> list[dict]:
        await self._scoped_budget(budget_id, writable=False, publications=True)
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
        allowed = {"owner"} if writable else {"owner", "lead"}
        if publications:
            allowed.add("management")
        if self.user.role not in allowed:
            raise HTTPException(status_code=403, detail="当前角色不能访问此数据")
        department, sector, owner = self._scope()
        budget = await self.repository.get_scoped_budget(
            budget_id, None, department, sector, owner, for_update
        )
        if budget is None:
            raise HTTPException(status_code=404, detail="Initiative 不存在或不在当前权限范围")
        return budget

    def _matches(self, budget: BudgetDO) -> bool:
        if self.user.role == "owner":
            return budget.owner_email == self.user.email
        return budget.department == self.user.department and (
            not self.user.sector or budget.sector == self.user.sector
        )

    def _scope(self) -> tuple[str | None, str | None, str | None]:
        if self.user.role == "owner":
            return self.user.department, self.user.sector, self.user.email
        if self.user.role == "lead":
            return self.user.department, self.user.sector, None
        if self.user.role == "management":
            return self.user.department, self.user.sector, None
        return None, None, None

    def _identity(self) -> dict:
        return {
            "key": self.user.email,
            "email": self.user.email,
            "role": self.user.role,
            "department": self.user.department,
            "ownerId": self.user.email,
            "label": self.user.display_name,
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
            "name": budget.initiative_name,
            "resourceType": budget.resource_type,
            "sector": budget.sector,
            "department": budget.department,
            "ownerId": budget.owner_email,
            "budget": float(budget.plan_budget_amount),
            "rows": [
                {
                    "dealerId": row.distributor_code,
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
            "publishedAt": publication.created_at.isoformat() if publication else None,
            "reserve": float(
                sum((row.amount for row in other if row.reason_id == "reserve"), Decimal("0"))
            ),
            "nonDealer": float(
                sum((row.amount for row in other if row.reason_id != "reserve"), Decimal("0"))
            ),
            "status": "completed" if budget.status == 1 else "draft",
            "savedAt": budget.updated_at.isoformat() if budget.updated_at else None,
        }

    @staticmethod
    def _publication(item: WorkspacePublicationDO) -> dict:
        initiative = dict(item.snapshot.get("initiative", {}))
        initiative.update(
            status="completed",
            publishedRevision=item.published_revision,
            publishedAt=item.created_at.isoformat(),
        )
        return {
            "id": str(item.id),
            "initiativeId": str(item.budget_id),
            "department": item.department,
            "number": item.publication_number,
            "createdAt": item.created_at.isoformat(),
            "publishedAt": item.created_at.isoformat(),
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
            "department": item.department,
            "sector": item.sector,
        }

    async def _validate_rows(self, rows: list, other: list, budget: BudgetDO) -> None:
        if len({item.dealerId for item in rows}) != len(rows):
            raise HTTPException(status_code=422, detail="经销商编码不能重复")
        references = await self.repository.references(budget.planning_year)
        existing = await self.repository.rows_for(budget.id)
        dealer_ids = {item.dealer_id for item in references} | {
            item.distributor_code for item in existing
        }
        if any(item.dealerId not in dealer_ids for item in rows):
            raise HTTPException(status_code=422, detail="经销商编码不存在")
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
            "CONFIG_UPDATE": "set_guide",
            "REFERENCE_IMPORT": "change_reference",
        }
        return {
            "id": str(item.id),
            "createdAt": item.changed_at.isoformat(),
            "actor": {"label": item.operator_id, "role": ""},
            "action": actions.get(item.operation_type, item.operation_type),
            "object": str(item.budget_id) if item.budget_id else "工作台配置",
            "detail": item.operation_note or str(item.after_data or {}),
            "budgetId": str(item.budget_id),
            "operation": item.operation_type,
            "operator": item.operator_id,
            "at": item.changed_at.isoformat(),
            "note": item.operation_note,
        }
