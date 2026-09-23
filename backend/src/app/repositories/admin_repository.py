from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.do.base import BaseDO
from app.models.do.budget import BudgetDO
from app.models.do.workspace import OtherBudgetDO, UserPermissionDO, WorkspaceConfigDO


class AdminRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def owners(self, email: str, department: str) -> Sequence[UserPermissionDO]:
        return (
            await self.session.scalars(
                select(UserPermissionDO).where(
                    UserPermissionDO.email == email,
                    UserPermissionDO.enabled.is_(True),
                    UserPermissionDO.role == "owner",
                    UserPermissionDO.department == department,
                )
            )
        ).all()

    async def locked_config(self) -> WorkspaceConfigDO | None:
        return (
            await self.session.scalars(
                select(WorkspaceConfigDO)
                .where(WorkspaceConfigDO.id == 1)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).one_or_none()

    async def locked_budget(self, budget_id: int) -> BudgetDO | None:
        return (
            await self.session.scalars(
                select(BudgetDO)
                .where(BudgetDO.id == budget_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).one_or_none()

    async def has_removed_reason_in_use(self, reason_ids: list[str]) -> bool:
        return (
            await self.session.scalar(
                select(OtherBudgetDO.id).where(OtherBudgetDO.reason_id.not_in(reason_ids)).limit(1)
            )
            is not None
        )

    def add(self, entity: BaseDO) -> None:
        self.session.add(entity)

    def add_budgets(self, entities: list[BudgetDO]) -> None:
        self.session.add_all(entities)

    async def business_key_exists(
        self, planning_year: int, sector: str, department: str, resource_type: str, name: str
    ) -> bool:
        return (
            await self.session.scalar(
                select(BudgetDO.id)
                .where(
                    BudgetDO.planning_year == planning_year,
                    BudgetDO.sector == sector,
                    BudgetDO.department == department,
                    BudgetDO.resource_type == resource_type,
                    BudgetDO.initiative_name == name,
                )
                .limit(1)
            )
        ) is not None
