from collections.abc import Mapping, Sequence
from decimal import Decimal
from hashlib import md5
from typing import cast

from sqlalchemy import Table, delete, exists, func, insert, select
from sqlalchemy.exc import MultipleResultsFound
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

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

    async def email_for_md5(self, digest: str) -> str | None:
        emails = await self.session.scalars(select(UserPermissionDO.email))
        matches = [
            email for email in emails
            if md5(
                email.strip().lower().encode("utf-8"), usedforsecurity=False
            ).hexdigest() == digest
        ]
        if len(matches) > 1:
            raise MultipleResultsFound
        return matches[0] if matches else None

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
        sector: str | tuple[str, ...] | None,
        owner: str | None,
        version_id: str | None = None,
    ) -> list[BudgetDO]:
        statement = select(BudgetDO).where(
            BudgetDO.planning_year == year, BudgetDO.planning_version_id == version_id
        )
        if department is not None:
            statement = statement.where(BudgetDO.department.in_(departments(department)))
        if sector is not None:
            statement = statement.where(
                BudgetDO.sector.in_((sector,) if isinstance(sector, str) else sector)
            )
        if owner:
            statement = statement.where(BudgetDO.owner_email == owner)
        return list((await self.session.scalars(statement.order_by(BudgetDO.id))).all())

    async def get_scoped_budget(
        self,
        budget_id: int,
        planning_year: int | None,
        department: str | list[str] | tuple[str, ...] | None,
        sector: str | tuple[str, ...] | None,
        owner_email: str | None,
        for_update: bool = False,
    ) -> BudgetDO | None:
        statement = select(BudgetDO).where(BudgetDO.id == budget_id)
        if planning_year is not None:
            statement = statement.where(BudgetDO.planning_year == planning_year)
        if department is not None:
            statement = statement.where(BudgetDO.department.in_(departments(department)))
        if sector is not None:
            statement = statement.where(
                BudgetDO.sector.in_((sector,) if isinstance(sector, str) else sector)
            )
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

    async def clear_draft_rows(self, budget_ids: list[int]) -> None:
        if budget_ids:
            for model in (BudgetDistributorDO, OtherBudgetDO):
                await self.session.execute(delete(model).where(model.budget_id.in_(budget_ids)))

    async def latest_draft_save_revisions(self, budget_ids: list[int]) -> dict[int, int]:
        if not budget_ids:
            return {}
        latest = (select(func.max(BudgetChangeLogDO.id).label("id"))
                  .where(BudgetChangeLogDO.budget_id.in_(budget_ids),
                         BudgetChangeLogDO.operation_type == "DRAFT_SAVE")
                  .group_by(BudgetChangeLogDO.budget_id).subquery())
        logs = await self.session.scalars(
            select(BudgetChangeLogDO).join(latest, BudgetChangeLogDO.id == latest.c.id)
        )
        return {log.budget_id: revision for log in logs
                if isinstance((revision := (log.after_data or {}).get("revision")), int)}

    @staticmethod
    def _publication_since_reset() -> ColumnElement[bool]:
        # Snapshots predating a reset remain immutable for audit and publication numbering.
        return ~exists().where(
            InitiativeWorkflowDO.budget_id == WorkspacePublicationDO.budget_id,
            InitiativeWorkflowDO.draft_reset_revision > WorkspacePublicationDO.published_revision,
        )

    async def publications_for(self, budget_id: int) -> list[WorkspacePublicationDO]:
        statement = (
            select(WorkspacePublicationDO)
            .where(WorkspacePublicationDO.budget_id == budget_id, self._publication_since_reset())
            .order_by(WorkspacePublicationDO.publication_number.asc())
        )
        return list((await self.session.scalars(statement)).all())

    async def latest_submissions_for(
        self, budget_ids: list[int],
    ) -> dict[int, WorkspacePublicationDO]:
        """Fetch only the final immutable submission for each requested budget."""
        if not budget_ids:
            return {}
        ranked = select(
            WorkspacePublicationDO.id,
            func.row_number().over(
                partition_by=WorkspacePublicationDO.budget_id,
                order_by=(WorkspacePublicationDO.publication_number.desc(),
                          WorkspacePublicationDO.id.desc()),
            ).label("position"),
        ).where(
            WorkspacePublicationDO.budget_id.in_(budget_ids), self._publication_since_reset(),
        ).subquery()
        return {item.budget_id: item for item in await self.session.scalars(
            select(WorkspacePublicationDO).join(ranked, ranked.c.id == WorkspacePublicationDO.id)
            .where(ranked.c.position == 1)
        )}

    async def next_publication_number(self, budget_id: int) -> int:
        latest = await self.session.scalar(
            select(func.max(WorkspacePublicationDO.publication_number))
            .where(WorkspacePublicationDO.budget_id == budget_id)
        )
        return int(latest or 0) + 1

    async def publications_by_ids(self, ids: list[int]) -> dict[int, WorkspacePublicationDO]:
        if not ids:
            return {}
        return {item.id: item for item in await self.session.scalars(
            select(WorkspacePublicationDO).where(WorkspacePublicationDO.id.in_(ids))
        )}

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
            select(WorkspacePublicationDO).where(
                WorkspacePublicationDO.budget_id.in_(budget_ids), self._publication_since_reset(),
            )
            .order_by(WorkspacePublicationDO.publication_number)
        ):
            publications.setdefault(publication.budget_id, []).append(publication)
        return rows, other, publications

    async def latest_publications(
        self,
        year: int,
        department: str | list[str] | tuple[str, ...] | None,
        sector: str | tuple[str, ...] | None,
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
        if sector is not None:
            ids = ids.where(BudgetDO.sector.in_((sector,) if isinstance(sector, str) else sector))
        if owner:
            ids = ids.where(BudgetDO.owner_email == owner)
        latest = (
            select(func.max(WorkspacePublicationDO.id))
            .where(WorkspacePublicationDO.budget_id.in_(ids), self._publication_since_reset())
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

    async def replace_rows(
        self, budget: BudgetDO, rows: list[dict], *,
        directory: Mapping[str, Mapping] | None = None,
        existing: Sequence[BudgetDistributorDO] | None = None,
    ) -> None:
        from app.core.dealer_identity import dealer_identity
        from app.repositories.reference_repository import ReferenceRepository

        if directory is None:
            records = await ReferenceRepository(self.session).list_directory(
                sectors=(budget.sector,),
            )
            directory = {dealer_identity(row): row for row in records}
        existing_by_id = {
            row.history_key or row.distributor_code: row
            for row in (existing if existing is not None else await self.rows_for(budget.id))
        }
        await self.session.execute(
            delete(BudgetDistributorDO).where(BudgetDistributorDO.budget_id == budget.id)
        )
        values = self.allocation_values(budget, rows, directory, existing_by_id)
        await self.insert_allocations(values)

    @staticmethod
    def allocation_values(
        budget: BudgetDO, rows: list[dict], directory: Mapping[str, Mapping],
        existing: Mapping[str, BudgetDistributorDO] | None = None,
    ) -> list[dict]:
        values = []
        for item in rows:
            source = directory.get(item["dealerId"])
            old = existing.get(item["dealerId"]) if existing else None
            values.append(
                dict(
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
        return values

    async def insert_allocations(self, values: list[dict]) -> None:
        if values:
            # The response reloads rows once; no generated ID/default is needed per allocation.
            await self.session.execute(insert(cast(Table, BudgetDistributorDO.__table__)), values)

    async def replace_other(self, budget_id: int, rows: list[dict]) -> None:
        await self.session.execute(
            delete(OtherBudgetDO).where(OtherBudgetDO.budget_id == budget_id)
        )
        await self.insert_other(self.other_values(budget_id, rows))

    @staticmethod
    def other_values(budget_id: int, rows: list[dict]) -> list[dict]:
        return [dict(budget_id=budget_id, reason_id=item["reasonId"],
                     amount=Decimal(item["amount"]), note=item.get("note")) for item in rows]

    async def insert_other(self, values: list[dict]) -> None:
        if values:
            await self.session.execute(insert(cast(Table, OtherBudgetDO.__table__)), values)

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
