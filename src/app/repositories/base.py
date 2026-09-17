from typing import Any, Generic, TypeVar

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.do.base import BaseDO

ModelT = TypeVar("ModelT", bound=BaseDO)


class BaseRepository(Generic[ModelT]):
    """Minimal reusable repository; business repositories should inherit from it."""

    def __init__(self, session: AsyncSession, model: type[ModelT]) -> None:
        self.session = session
        self.model = model

    async def get(self, primary_key: Any) -> ModelT | None:
        return await self.session.get(self.model, primary_key)

    async def add(self, entity: ModelT) -> ModelT:
        self.session.add(entity)
        await self.session.flush()
        return entity

