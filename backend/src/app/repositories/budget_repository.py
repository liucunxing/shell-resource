from decimal import Decimal
from typing import cast

from sqlalchemy import Select, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.models.do.budget import BudgetDO
from app.models.do.budget_distributor import BudgetDistributorDO
from app.repositories.base import BaseRepository


class BudgetRepository(BaseRepository[BudgetDO]):
    """Queries for the workbench's Initiative budgets."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, BudgetDO)

    async def list_for_workbench(
        self,
        *,
        planning_year: int,
        department: str,
        sector: str,
        initiative_keyword: str | None,
        resource_type_keyword: str | None,
        status: int | None,
    ) -> list[BudgetDO]:
        statement: Select[tuple[BudgetDO]] = select(BudgetDO).where(
            BudgetDO.planning_year == planning_year,
            BudgetDO.department == department,
            BudgetDO.sector == sector,
        )
        if initiative_keyword:
            statement = statement.where(
                BudgetDO.initiative_name.ilike(f"%{initiative_keyword.strip()}%")
            )
        if resource_type_keyword:
            statement = statement.where(
                BudgetDO.resource_type.ilike(f"%{resource_type_keyword.strip()}%")
            )
        if status is not None:
            statement = statement.where(BudgetDO.status == status)
        statement = statement.order_by(BudgetDO.initiative_name, BudgetDO.id)
        return list((await self.session.scalars(statement)).all())

    async def get_scoped(
        self,
        *,
        budget_id: int,
        planning_year: int,
        department: str,
        sector: str,
    ) -> BudgetDO | None:
        statement = select(BudgetDO).where(
            BudgetDO.id == budget_id,
            BudgetDO.planning_year == planning_year,
            BudgetDO.department == department,
            BudgetDO.sector == sector,
        )
        return cast(BudgetDO | None, await self.session.scalar(statement))

    async def get_dashboard_totals(
        self,
        *,
        planning_year: int,
        department: str,
        sector: str,
    ) -> tuple[int, Decimal, int]:
        statement = select(
            func.count(BudgetDO.id),
            func.coalesce(func.sum(BudgetDO.plan_budget_amount), Decimal("0")),
            func.coalesce(
                func.sum(case((BudgetDO.status == 1, 1), else_=0)),
                0,
            ),
        ).where(
            BudgetDO.planning_year == planning_year,
            BudgetDO.department == department,
            BudgetDO.sector == sector,
        )
        result = (await self.session.execute(statement)).one()
        return int(result[0]), Decimal(result[1]), int(result[2])


class BudgetDistributorRepository(BaseRepository[BudgetDistributorDO]):
    """Queries and writes for distributor-level budget allocations."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, BudgetDistributorDO)

    @staticmethod
    def _belongs_to_budget(budget: BudgetDO) -> tuple[ColumnElement[bool], ...]:
        return (
            BudgetDistributorDO.planning_year == budget.planning_year,
            BudgetDistributorDO.sector == budget.sector,
            BudgetDistributorDO.department == budget.department,
            BudgetDistributorDO.resource_type == budget.resource_type,
            BudgetDistributorDO.initiative_name == budget.initiative_name,
        )

    async def list_for_budget(self, budget: BudgetDO) -> list[BudgetDistributorDO]:
        statement = select(BudgetDistributorDO).where(
            *self._belongs_to_budget(budget)
        ).order_by(BudgetDistributorDO.distributor_code, BudgetDistributorDO.id)
        return list((await self.session.scalars(statement)).all())

    async def get_for_budget(
        self,
        budget: BudgetDO,
        allocation_id: int,
    ) -> BudgetDistributorDO | None:
        statement = select(BudgetDistributorDO).where(
            BudgetDistributorDO.id == allocation_id,
            *self._belongs_to_budget(budget),
        )
        return cast(BudgetDistributorDO | None, await self.session.scalar(statement))

    async def get_total_for_budget(self, budget: BudgetDO) -> Decimal:
        statement = select(
            func.coalesce(
                func.sum(BudgetDistributorDO.distributor_budget_amount),
                Decimal("0"),
            )
        ).where(*self._belongs_to_budget(budget))
        result = await self.session.scalar(statement)
        return Decimal(result or 0)

    async def add_for_budget(
        self,
        *,
        budget: BudgetDO,
        distributor_code: str,
        distributor_budget_amount: Decimal,
        description: str | None,
    ) -> BudgetDistributorDO:
        entity = BudgetDistributorDO(
            planning_year=budget.planning_year,
            sector=budget.sector,
            department=budget.department,
            resource_type=budget.resource_type,
            initiative_name=budget.initiative_name,
            distributor_code=distributor_code,
            distributor_budget_amount=distributor_budget_amount,
            input_source="MANUAL",
            description=description,
        )
        return await self.add(entity)
