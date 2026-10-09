from fastapi import HTTPException, status

from app.core.config import Settings
from app.repositories.distributor_directory_repository import (
    DatabricksConfigurationError,
    DatabricksDirectoryError,
    DatabricksDistributorRepository,
)


class DistributorDirectoryService:
    """Expose the Databricks distributor master using the workbench dealer contract."""

    def __init__(
        self,
        settings: Settings,
        repository: DatabricksDistributorRepository | None = None,
    ) -> None:
        self.repository = repository or DatabricksDistributorRepository(settings)

    async def list_distributors(self, sectors: tuple[str, ...]) -> list[dict]:
        if not sectors:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="当前 Owner 未配置业务线",
            )
        try:
            rows = await self.repository.list_distributors(sectors)
        except DatabricksConfigurationError as error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Databricks 经销商目录尚未配置",
            ) from error
        except DatabricksDirectoryError as error:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Databricks 经销商目录查询失败，请稍后重试",
            ) from error
        return [
            {
                "id": row["distributor_code"],
                "name": row["distributor_name"],
            }
            for row in rows
        ]

    async def distributor_codes(self, sectors: tuple[str, ...]) -> set[str]:
        return {item["id"] for item in await self.list_distributors(sectors)}
