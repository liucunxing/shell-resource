from collections.abc import Sequence

from sqlalchemy import (
    SQLColumnExpression,
    String,
    and_,
    cast,
    delete,
    exists,
    func,
    select,
    true,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement
from sqlalchemy.sql.selectable import Exists

from app.core.departments import departments
from app.models.do.base import BaseDO
from app.models.do.budget import BudgetDO
from app.models.do.budget_distributor import BudgetDistributorDO
from app.models.do.workspace import (
    OtherBudgetDO,
    UserPermissionDO,
    WorkspaceConfigDO,
    WorkspacePublicationDO,
)


class AdminRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def owners(self, email: str, department: str) -> Sequence[UserPermissionDO]:
        return (
            await self.session.scalars(
                select(UserPermissionDO)
                .where(
                    func.lower(func.trim(UserPermissionDO.email)) == email.strip().lower(),
                    UserPermissionDO.enabled.is_(True),
                    self._department_member(department),
                )
                .with_for_update()
            )
        ).all()

    def _department_member(self, department: str) -> ColumnElement[bool]:
        if self.session.get_bind().dialect.name == "sqlite":
            entries = func.json_each(UserPermissionDO.department).table_valued("value")
            return exists(select(1).select_from(entries).where(entries.c.value == department))
        return UserPermissionDO.department.any_() == department

    @staticmethod
    def _budget_for_email(email_column: str | SQLColumnExpression[str]) -> Exists:
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
        sector: str | None,
        limit: int,
        offset: int,
    ) -> tuple[list[tuple[UserPermissionDO, bool]], int, list[UserPermissionDO]]:
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
            conditions.append(self._department_member(department))
        if sector:
            conditions.append(cast(UserPermissionDO.sector, String).contains(sector))
        # A listing already needs every user for its import revision and lead
        # coverage. Read those and the filtered page from one MVCC snapshot,
        # without taking the global configuration write lock. Keep matching and
        # ordering in SQL so existing search/collation semantics are unchanged.
        matches = and_(*conditions) if conditions else true()
        assigned_emails = (
            select(func.lower(func.trim(BudgetDO.owner_email)).label("email"))
            .where(BudgetDO.owner_email.is_not(None))
            .distinct()
            .subquery()
        )
        statement = (
            select(UserPermissionDO, assigned_emails.c.email.is_not(None), matches)
            .outerjoin(
                assigned_emails,
                assigned_emails.c.email == func.lower(func.trim(UserPermissionDO.email)),
            )
            .order_by(UserPermissionDO.email)
            .execution_options(populate_existing=True)
        )
        rows = (await self.session.execute(statement)).all()
        matching = [(user, bool(has_budget)) for user, has_budget, matched in rows if matched]
        return matching[offset:offset + limit], len(matching), [user for user, _, _ in rows]

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

    async def locked_enabled_users_by_department(
        self, department: str
    ) -> Sequence[UserPermissionDO]:
        return (
            await self.session.scalars(
                select(UserPermissionDO)
                .where(
                    self._department_member(department),
                    UserPermissionDO.enabled.is_(True),
                )
                .with_for_update()
            )
        ).all()

    async def lead_sectors_by_department(self) -> dict[str, list[str]]:
        leads = (
            await self.session.scalars(
                select(UserPermissionDO).where(
                    UserPermissionDO.role == "lead",
                    UserPermissionDO.enabled.is_(True),
                    UserPermissionDO.department.is_not(None),
                )
            )
        ).all()
        result: dict[str, set[str]] = {}
        for lead in leads:
            for department in departments(lead.department):
                result.setdefault(department, set()).update(lead.sector or [])
        return {department: sorted(sectors) for department, sectors in result.items()}

    async def assigned_budget_scopes_by_email(
        self, emails: list[str],
    ) -> dict[str, set[tuple[str, str]]]:
        if not emails:
            return {}
        email = func.lower(func.trim(BudgetDO.owner_email))
        rows = await self.session.execute(
            select(email, BudgetDO.department, BudgetDO.sector)
            .where(email.in_([value.strip().lower() for value in emails]))
            .distinct()
        )
        result: dict[str, set[tuple[str, str]]] = {}
        for owner_email, department, sector in rows:
            result.setdefault(str(owner_email), set()).add((str(department), str(sector)))
        return result

    async def user_has_budgets(self, email: str) -> bool:
        return bool(await self.session.scalar(select(self._budget_for_email(email.strip()))))

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
        return bool((await self.used_reason_ids()) - set(reason_ids))

    async def used_reason_ids(self) -> set[str]:
        used = set((await self.session.scalars(select(OtherBudgetDO.reason_id).distinct())).all())
        # Project just reason rows, never the much larger dealer allocation/history payload.
        # Preserve the original legacy top-level fallback only when initiative is absent.
        snapshot = WorkspacePublicationDO.snapshot
        has_initiative = (
            func.json_type(snapshot, "$.initiative").is_not(None)
            if self.session.get_bind().dialect.name == "sqlite"
            else func.jsonb_exists(cast(snapshot, JSONB), "initiative")
        )
        snapshots = await self.session.execute(select(
            has_initiative, snapshot["initiative"]["otherBudgets"], snapshot["otherBudgets"],
        ))
        for nested, initiative_rows, legacy_rows in snapshots:
            reasons = initiative_rows if nested else legacy_rows
            if not isinstance(reasons, list):
                continue
            used.update(
                row["reasonId"] for row in reasons
                if isinstance(row, dict) and row.get("reasonId")
            )
        return used

    def add(self, entity: BaseDO) -> None:
        self.session.add(entity)

    def add_budgets(self, entities: list[BudgetDO]) -> None:
        self.session.add_all(entities)

    async def business_key_exists(
        self, planning_year: int, sector: str, department: str, resource_type: str, name: str,
        exclude_id: int | None = None,
    ) -> bool:
        statement = select(BudgetDO.id).where(
            BudgetDO.planning_year == planning_year,
            BudgetDO.sector == sector,
            BudgetDO.department == department,
            BudgetDO.resource_type == resource_type,
            BudgetDO.initiative_name == name,
        )
        if exclude_id is not None:
            statement = statement.where(BudgetDO.id != exclude_id)
        return await self.session.scalar(statement.limit(1)) is not None

    async def sync_allocation_metadata(self, budget: BudgetDO) -> None:
        await self.session.execute(
            update(BudgetDistributorDO).where(BudgetDistributorDO.budget_id == budget.id).values(
                sector=budget.sector, department=budget.department,
                resource_type=budget.resource_type, initiative_name=budget.initiative_name,
            )
        )

    async def delete_budget(self, budget: BudgetDO) -> None:
        for model in (BudgetDistributorDO, OtherBudgetDO, WorkspacePublicationDO):
            await self.session.execute(delete(model).where(model.budget_id == budget.id))
        await self.session.delete(budget)
