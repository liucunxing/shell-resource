from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.departments import departments
from app.models.do.budget import BudgetDO
from app.models.do.budget_distributor import BudgetDistributorDO
from app.models.do.planning import InitiativeWorkflowDO, PlanningVersionDO
from app.models.do.workspace import (
    BudgetChangeLogDO,
    OtherBudgetDO,
    UserPermissionDO,
    WorkspaceConfigDO,
    WorkspacePublicationDO,
)


class WorkspaceRepository:
    """Explicit workbench persistence queries; transactions stay in the service."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_permission(self, email: str) -> UserPermissionDO | None:
        # Check all matching records before enabled status: legacy case variants
        # must never choose an arbitrary role or bypass a disabled identity.
        statement = (
            select(UserPermissionDO)
            .where(func.lower(func.trim(UserPermissionDO.email)) == email.strip().lower())
            .limit(2)
            .execution_options(populate_existing=True)
        )
        permission = (await self.session.scalars(statement)).one_or_none()
        return permission if permission is not None and permission.enabled else None

    async def list_users(self) -> list[UserPermissionDO]:
        return list(
            (
                await self.session.scalars(
                    select(UserPermissionDO).where(UserPermissionDO.enabled.is_(True))
                )
            ).all()
        )

    async def administrator_contacts(self) -> list[dict[str, str]]:
        rows = await self.session.execute(
            select(UserPermissionDO.display_name, UserPermissionDO.email)
            .where(UserPermissionDO.enabled.is_(True), UserPermissionDO.role == "admin")
            .order_by(UserPermissionDO.id)
        )
        return [{"name": name, "email": email} for name, email in rows]

    async def list_budgets(
        self,
        year: int,
        department: str | list[str] | tuple[str, ...] | None,
        sector: str | None,
        owner: str | None,
        version_id: str | None = None,
    ) -> list[BudgetDO]:
        statement = select(BudgetDO).where(
            BudgetDO.planning_year == year, BudgetDO.planning_version_id == version_id
        )
        if department is not None:
            statement = statement.where(BudgetDO.department.in_(departments(department)))
        if sector:
            statement = statement.where(BudgetDO.sector == sector)
        if owner:
            statement = statement.where(BudgetDO.owner_email == owner)
        return list((await self.session.scalars(statement.order_by(BudgetDO.id))).all())

    async def get_scoped_budget(
        self,
        budget_id: int,
        planning_year: int | None,
        department: str | list[str] | tuple[str, ...] | None,
        sector: str | None,
        owner_email: str | None,
        for_update: bool = False,
    ) -> BudgetDO | None:
        statement = select(BudgetDO).where(BudgetDO.id == budget_id)
        if planning_year is not None:
            statement = statement.where(BudgetDO.planning_year == planning_year)
        if department is not None:
            statement = statement.where(BudgetDO.department.in_(departments(department)))
        if sector:
            statement = statement.where(BudgetDO.sector == sector)
        if owner_email:
            statement = statement.where(BudgetDO.owner_email == owner_email)
        if for_update:
            statement = statement.with_for_update().execution_options(populate_existing=True)
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

    async def projection_rows(
        self, budget_ids: list[int], *, include_drafts: bool = True,
    ) -> tuple[
        dict[int, list[BudgetDistributorDO]], dict[int, list[OtherBudgetDO]],
        dict[int, list[WorkspacePublicationDO]],
    ]:
        """Load only the caller's authorized budgets in a fixed number of queries."""
        rows: dict[int, list[BudgetDistributorDO]] = {}
        other: dict[int, list[OtherBudgetDO]] = {}
        publications: dict[int, list[WorkspacePublicationDO]] = {}
        if not budget_ids:
            return rows, other, publications
        if include_drafts:
            for row in await self.session.scalars(
                select(BudgetDistributorDO).where(BudgetDistributorDO.budget_id.in_(budget_ids))
                .order_by(BudgetDistributorDO.id)
            ):
                if row.budget_id is not None:
                    rows.setdefault(row.budget_id, []).append(row)
            for reserve in await self.session.scalars(
                select(OtherBudgetDO).where(OtherBudgetDO.budget_id.in_(budget_ids))
                .order_by(OtherBudgetDO.id)
            ):
                other.setdefault(reserve.budget_id, []).append(reserve)
        for publication in await self.session.scalars(
            select(WorkspacePublicationDO).where(WorkspacePublicationDO.budget_id.in_(budget_ids))
            .order_by(WorkspacePublicationDO.publication_number)
        ):
            publications.setdefault(publication.budget_id, []).append(publication)
        return rows, other, publications

    async def latest_publications(
        self,
        year: int,
        department: str | list[str] | tuple[str, ...] | None,
        sector: str | None,
        owner: str | None,
        version_id: str | None = None,
    ) -> list[WorkspacePublicationDO]:
        if version_id is None:
            version_id = await self.session.scalar(
                select(PlanningVersionDO.id)
                .where(
                    PlanningVersionDO.planning_year == year, PlanningVersionDO.published.is_(True),
                    PlanningVersionDO.deleted_at.is_(None)
                )
                .order_by(
                    PlanningVersionDO.open.desc(),
                    PlanningVersionDO.created_at.desc(),
                    PlanningVersionDO.id.desc(),
                )
                .limit(1)
            )
            if version_id is None and await self.session.scalar(
                select(PlanningVersionDO.id).where(PlanningVersionDO.planning_year == year).limit(1)
            ):
                return []
        ids = select(BudgetDO.id).where(
            BudgetDO.planning_year == year, BudgetDO.planning_version_id == version_id
        )
        if version_id:
            ids = ids.where(BudgetDO.enabled.is_(True))
        if department is not None:
            ids = ids.where(BudgetDO.department.in_(departments(department)))
        if sector:
            ids = ids.where(BudgetDO.sector == sector)
        if owner:
            ids = ids.where(BudgetDO.owner_email == owner)
        latest = (
            select(func.max(WorkspacePublicationDO.id))
            .where(WorkspacePublicationDO.budget_id.in_(ids))
            .group_by(WorkspacePublicationDO.budget_id)
        )
        statement = select(WorkspacePublicationDO).where(WorkspacePublicationDO.id.in_(latest))
        if version_id:
            statement = statement.where(
                WorkspacePublicationDO.id.in_(
                    select(InitiativeWorkflowDO.confirmed_publication_id).where(
                        InitiativeWorkflowDO.requires_resubmission.is_(False)
                    )
                )
            )
        return list((await self.session.scalars(statement)).all())

    async def config(self) -> WorkspaceConfigDO | None:
        return await self.session.get(WorkspaceConfigDO, 1)

    async def replace_rows(self, budget: BudgetDO, rows: list[dict]) -> None:
        from app.core.dealer_identity import dealer_identity
        from app.repositories.reference_repository import ReferenceRepository

        records = await ReferenceRepository(self.session).list_directory(sectors=(budget.sector,))
        directory = {dealer_identity(row): row for row in records}
        existing = {
            row.history_key or row.distributor_code: row for row in await self.rows_for(budget.id)
        }
        await self.session.execute(
            delete(BudgetDistributorDO).where(BudgetDistributorDO.budget_id == budget.id)
        )
        for item in rows:
            source = directory.get(item["dealerId"])
            old = existing.get(item["dealerId"])
            self.session.add(
                BudgetDistributorDO(
                    budget_id=budget.id,
                    planning_year=budget.planning_year,
                    sector=budget.sector,
                    department=budget.department,
                    resource_type=budget.resource_type,
                    initiative_name=budget.initiative_name,
                    distributor_code=source["distributor_code"]
                    if source
                    else (old.distributor_code if old else item["dealerId"]),
                    history_key=item["dealerId"]
                    if item["dealerId"].startswith("history:")
                    else None,
                    sd=source["sd"] if source else (old.sd if old else None),
                    rsm=source["rsm"] if source else (old.rsm if old else None),
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
        statement = select(BudgetChangeLogDO)
        if not admin:
            statement = statement.where(BudgetChangeLogDO.budget_id.in_(allowed_ids))
        return list(
            (
                await self.session.scalars(statement.order_by(BudgetChangeLogDO.changed_at.desc()))
            ).all()
        )
