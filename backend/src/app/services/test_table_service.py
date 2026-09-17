from fastapi import HTTPException, status

from app.repositories.test_table_repository import TestTableRepository
from app.schemas.vo.test_table import TestTableValueVO


class TestTableService:
    """Service for verifying the complete PostgreSQL request path."""

    def __init__(self, repository: TestTableRepository) -> None:
        self.repository = repository

    async def get_first_value(self) -> TestTableValueVO:
        value = await self.repository.get_first_value()
        if value is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="data.test_table 中没有数据",
            )
        return TestTableValueVO(value)
