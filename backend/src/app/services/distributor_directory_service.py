from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dealer_identity import dealer_identity
from app.core.distributor_status import distributor_status
from app.repositories.reference_repository import ReferenceRepository


class DistributorDirectoryService:
    """Expose the PostgreSQL history list using the workbench dealer contract."""

    def __init__(
        self,
        session: AsyncSession,
        repository: ReferenceRepository | None = None,
    ) -> None:
        self.repository = repository or ReferenceRepository(session)

    async def list_distributors(self, sectors: tuple[str, ...] | None) -> list[dict]:
        if sectors is not None and not sectors:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="当前用户未配置业务线",
            )
        rows = await self.repository.list_dealers(sectors=sectors)
        result: list[dict] = []
        for row in rows:
            if distributor_status(row["distributor_status"]) != "active":
                continue
            code = str(row["distributor_code"]).strip()
            sector = row["sector"]
            if not code:
                continue
            result.append(
                {
                    "id": dealer_identity(row),
                    "code": code,
                    "name": row["distributor_name"],
                    "sector": sector,
                    "sd": row["sd"],
                    "rsm": row["rsm"],
                    "status": "active",
                }
            )
        return result

    async def distributor_codes(self, sectors: tuple[str, ...]) -> set[str]:
        return {item["id"] for item in await self.list_distributors(sectors)}
