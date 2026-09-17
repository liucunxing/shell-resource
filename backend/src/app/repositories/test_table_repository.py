from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.do.test_table import TestTableDO
from app.repositories.base import BaseRepository


class TestTableRepository(BaseRepository[TestTableDO]):
    """Database access for the data.test_table connectivity check."""

    def __init__(self, session: AsyncSession) -> None:
        super().__init__(session, TestTableDO)

    async def get_first_value(self) -> int | None:
        statement = select(TestTableDO.column_1).limit(1)
        return cast(int | None, await self.session.scalar(statement))
