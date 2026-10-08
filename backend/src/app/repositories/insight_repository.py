from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.do.insight import InsightPromptDO, InsightRecordDO
from app.repositories.base import BaseRepository


class InsightRepository(BaseRepository[InsightRecordDO]):
    """Explicit storage operations for Insight; no generic analysis framework."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, InsightRecordDO)

    async def get_prompt(self, planning_year: int, scope: str) -> InsightPromptDO | None:
        statement = select(InsightPromptDO).where(
            InsightPromptDO.planning_year == planning_year,
            InsightPromptDO.scope == scope,
        )
        return (await self.session.scalars(statement)).one_or_none()

    async def get_prompt_for_update(self, planning_year: int, scope: str) -> InsightPromptDO | None:
        statement = (
            select(InsightPromptDO)
            .where(
                InsightPromptDO.planning_year == planning_year,
                InsightPromptDO.scope == scope,
            )
            .with_for_update()
        )
        return (await self.session.scalars(statement)).one_or_none()

    async def add_prompt(self, prompt: InsightPromptDO) -> InsightPromptDO:
        self.session.add(prompt)
        await self.session.flush()
        return prompt

    async def latest_record(
        self, planning_year: int, scope: str, created_by_email: str | None = None
    ) -> InsightRecordDO | None:
        statement = (
            select(InsightRecordDO)
            .where(InsightRecordDO.planning_year == planning_year, InsightRecordDO.scope == scope)
            .order_by(desc(InsightRecordDO.created_at), desc(InsightRecordDO.id))
            .limit(1)
        )
        if created_by_email is not None:
            statement = statement.where(InsightRecordDO.created_by_email == created_by_email)
        return (await self.session.scalars(statement)).one_or_none()

    async def add_record(self, record: InsightRecordDO) -> InsightRecordDO:
        return await self.add(record)
