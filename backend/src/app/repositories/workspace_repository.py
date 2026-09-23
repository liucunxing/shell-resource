from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.do.budget import BudgetDO
from app.models.do.budget_distributor import BudgetDistributorDO
from app.models.do.workspace import (
    BudgetChangeLogDO,
    OtherBudgetDO,
    UserPermissionDO,
    WorkspaceConfigDO,
    WorkspacePublicationDO,
    WorkspaceReferenceDO,
)


class WorkspaceRepository:
    """Explicit workbench persistence queries; transactions stay in the service."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_permission(self, email: str) -> UserPermissionDO | None:
        statement = select(UserPermissionDO).where(
            UserPermissionDO.email == email, UserPermissionDO.enabled.is_(True)
        )
        return (await self.session.scalars(statement)).one_or_none()

    async def list_users(self) -> list[UserPermissionDO]:
        return list(
            (
                await self.session.scalars(
                    select(UserPermissionDO).where(UserPermissionDO.enabled.is_(True))
                )
            ).all()
        )

    async def list_budgets(
        self, year: int, department: str | None, sector: str | None, owner: str | None
    ) -> list[BudgetDO]:
        statement = select(BudgetDO).where(BudgetDO.planning_year == year)
        if department:
            statement = statement.where(BudgetDO.department == department)
        if sector:
            statement = statement.where(BudgetDO.sector == sector)
        if owner:
            statement = statement.where(BudgetDO.owner_email == owner)
        return list((await self.session.scalars(statement.order_by(BudgetDO.id))).all())

    async def get_scoped_budget(
        self,
        budget_id: int,
        planning_year: int | None,
        department: str | None,
        sector: str | None,
        owner_email: str | None,
        for_update: bool = False,
    ) -> BudgetDO | None:
        statement = select(BudgetDO).where(BudgetDO.id == budget_id)
        if planning_year is not None:
            statement = statement.where(BudgetDO.planning_year == planning_year)
        if department:
            statement = statement.where(BudgetDO.department == department)
        if sector:
            statement = statement.where(BudgetDO.sector == sector)
        if owner_email:
            statement = statement.where(BudgetDO.owner_email == owner_email)
        if for_update:
            statement = statement.with_for_update()
        return (await self.session.scalars(statement)).one_or_none()

    async def rows_for(self, budget_id: int) -> list[BudgetDistributorDO]:
        statement = (
            select(BudgetDistributorDO)
            .where(BudgetDistributorDO.budget_id == budget_id)
            .order_by(BudgetDistributorDO.id)
        )
        return list((await self.session.scalars(statement)).all())

    async def other_for(self, budget_id: int) -> list[OtherBudgetDO]:
        return list(
            (
                await self.session.scalars(
                    select(OtherBudgetDO)
                    .where(OtherBudgetDO.budget_id == budget_id)
                    .order_by(OtherBudgetDO.id)
                )
            ).all()
        )

    async def publications_for(self, budget_id: int) -> list[WorkspacePublicationDO]:
        statement = (
            select(WorkspacePublicationDO)
            .where(WorkspacePublicationDO.budget_id == budget_id)
            .order_by(WorkspacePublicationDO.publication_number.asc())
        )
        return list((await self.session.scalars(statement)).all())

    async def latest_publications(
        self, year: int, department: str | None, sector: str | None, owner: str | None
    ) -> list[WorkspacePublicationDO]:
        ids = select(BudgetDO.id).where(BudgetDO.planning_year == year)
        if department:
            ids = ids.where(BudgetDO.department == department)
        if sector:
            ids = ids.where(BudgetDO.sector == sector)
        if owner:
            ids = ids.where(BudgetDO.owner_email == owner)
        latest = (
            select(func.max(WorkspacePublicationDO.id))
            .where(WorkspacePublicationDO.budget_id.in_(ids))
            .group_by(WorkspacePublicationDO.budget_id)
        )
        return list(
            (
                await self.session.scalars(
                    select(WorkspacePublicationDO).where(WorkspacePublicationDO.id.in_(latest))
                )
            ).all()
        )

    async def config(self) -> WorkspaceConfigDO | None:
        return await self.session.get(WorkspaceConfigDO, 1)

    async def references(self, year: int) -> list[WorkspaceReferenceDO]:
        return list(
            (
                await self.session.scalars(
                    select(WorkspaceReferenceDO).where(WorkspaceReferenceDO.planning_year == year)
                )
            ).all()
        )

    async def replace_rows(self, budget: BudgetDO, rows: list[dict]) -> None:
        await self.session.execute(
            delete(BudgetDistributorDO).where(BudgetDistributorDO.budget_id == budget.id)
        )
        for item in rows:
            self.session.add(
                BudgetDistributorDO(
                    budget_id=budget.id,
                    planning_year=budget.planning_year,
                    sector=budget.sector,
                    department=budget.department,
                    resource_type=budget.resource_type,
                    initiative_name=budget.initiative_name,
                    distributor_code=item["dealerId"],
                    distributor_budget_amount=Decimal(item["amount"]),
                    input_source="DRAFT",
                    description=item.get("note"),
                )
            )

    async def replace_other(self, budget_id: int, rows: list[dict]) -> None:
        await self.session.execute(
            delete(OtherBudgetDO).where(OtherBudgetDO.budget_id == budget_id)
        )
        for item in rows:
            self.session.add(
                OtherBudgetDO(
                    budget_id=budget_id,
                    reason_id=item["reasonId"],
                    amount=Decimal(item["amount"]),
                    note=item.get("note"),
                )
            )

    def add_log(
        self,
        budget_id: int,
        operation: str,
        operator: str,
        before: dict | None,
        after: dict | None,
        note: str | None = None,
    ) -> None:
        self.session.add(
            BudgetChangeLogDO(
                budget_id=budget_id,
                operation_type=operation,
                operator_id=operator,
                before_data=before,
                after_data=after,
                operation_note=note,
            )
        )

    async def logs_for(self, budget_ids: list[int], admin: bool = False) -> list[BudgetChangeLogDO]:
        if not budget_ids and not admin:
            return []
        allowed_ids = [*budget_ids, 0] if admin else budget_ids
        statement = select(BudgetChangeLogDO).where(BudgetChangeLogDO.budget_id.in_(allowed_ids))
        if admin:
            statement = statement.where(
                BudgetChangeLogDO.operation_type.in_(
                    ["ADMIN_UPDATE", "ADMIN_CREATE", "CONFIG_UPDATE", "REFERENCE_IMPORT"]
                )
            )
        return list(
            (
                await self.session.scalars(statement.order_by(BudgetChangeLogDO.changed_at.desc()))
            ).all()
        )
