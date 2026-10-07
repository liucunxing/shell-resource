from collections.abc import Sequence

from sqlalchemy import func, select
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
                ).with_for_update()
            )
        ).all()

    @staticmethod
    def _budget_for_email(email_column):
        return (
            select(BudgetDO.id)
            .where(func.lower(func.trim(BudgetDO.owner_email)) == func.lower(email_column))
            .exists()
        )

    async def list_users(
        self,
        *,
        email: str | None,
        name: str | None,
        role: str | None,
        department: str | None,
        limit: int,
        offset: int,
    ) -> tuple[list[tuple[UserPermissionDO, bool]], int]:
        conditions = []
        if email:
            conditions.append(
                func.lower(UserPermissionDO.email).contains(email.lower(), autoescape=True)
            )
        if name:
            conditions.append(
                func.lower(UserPermissionDO.display_name).contains(name.lower(), autoescape=True)
            )
        if role:
            conditions.append(UserPermissionDO.role == role)
        if department:
            conditions.append(UserPermissionDO.department == department)
        total = await self.session.scalar(
            select(func.count()).select_from(UserPermissionDO).where(*conditions)
        )
        statement = (
            select(UserPermissionDO, self._budget_for_email(UserPermissionDO.email))
            .where(*conditions)
            .order_by(UserPermissionDO.email)
            .limit(limit)
            .offset(offset)
        )
        rows = (await self.session.execute(statement)).all()
        return [(user, bool(has_budget)) for user, has_budget in rows], int(total or 0)

    async def user_by_email(self, email: str) -> UserPermissionDO | None:
        return await self.session.scalar(
            select(UserPermissionDO).where(func.lower(UserPermissionDO.email) == email.lower())
        )

    async def locked_user(self, user_id: int) -> UserPermissionDO | None:
        return await self.session.scalar(
            select(UserPermissionDO)
            .where(UserPermissionDO.id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    async def user_has_budgets(self, email: str) -> bool:
        return bool(await self.session.scalar(select(self._budget_for_email(email))))

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
