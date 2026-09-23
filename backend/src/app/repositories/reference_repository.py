from collections.abc import Sequence

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.do.workspace import WorkspaceReferenceDO


class ReferenceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_dealers(
        self, planning_year: int, dealer_ids: list[str] | None = None
    ) -> Sequence[WorkspaceReferenceDO]:
        statement = select(WorkspaceReferenceDO).where(
            WorkspaceReferenceDO.planning_year == planning_year
        )
        if dealer_ids is not None:
            statement = statement.where(WorkspaceReferenceDO.dealer_id.in_(dealer_ids))
        return (
            await self.session.scalars(statement.order_by(WorkspaceReferenceDO.dealer_id))
        ).all()

    async def clear_year(self, planning_year: int) -> None:
        await self.session.execute(
            delete(WorkspaceReferenceDO).where(WorkspaceReferenceDO.planning_year == planning_year)
        )

    def add(self, entity: WorkspaceReferenceDO) -> None:
        self.session.add(entity)
