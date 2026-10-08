from collections.abc import Sequence

from sqlalchemy import RowMapping, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.do.distributor_history import distributor_sellin_resource_history
from app.models.do.workspace import WorkspaceReferenceDO


class ReferenceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_dealers(
        self, dealer_ids: list[str] | None = None
    ) -> Sequence[RowMapping]:
        statement = select(distributor_sellin_resource_history).distinct()
        if dealer_ids is not None:
            statement = statement.where(
                distributor_sellin_resource_history.c.distributor_code.in_(dealer_ids)
            )
        result = await self.session.execute(
            statement.order_by(distributor_sellin_resource_history.c.distributor_code)
        )
        return result.mappings().all()

    async def list_directory(self) -> Sequence[RowMapping]:
        statement = select(
            distributor_sellin_resource_history.c.distributor_code,
            distributor_sellin_resource_history.c.distributor_name,
        )
        statement = statement.distinct().order_by(
            distributor_sellin_resource_history.c.distributor_code
        )
        return (await self.session.execute(statement)).mappings().all()

    async def count_dealers(self) -> int:
        statement = select(func.count()).select_from(distributor_sellin_resource_history)
        return int((await self.session.scalar(statement)) or 0)

    async def clear_year(self, planning_year: int) -> None:
        await self.session.execute(
            delete(WorkspaceReferenceDO).where(WorkspaceReferenceDO.planning_year == planning_year)
        )

    def add(self, entity: WorkspaceReferenceDO) -> None:
        self.session.add(entity)
