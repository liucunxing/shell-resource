from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.departments import departments
from app.core.resource_access import default_department_resources
from app.repositories.reference_repository import ReferenceRepository
from app.repositories.workspace_repository import WorkspaceRepository


class ReferenceService:
    def __init__(self, session: AsyncSession) -> None:
        self.repository = ReferenceRepository(session)
        self.workspace_repository = WorkspaceRepository(session)

    async def get_dealers(
        self,
        planning_year: int,
        department: str | tuple[str, ...] | list[str] | None = None,
        dealer_ids: list[str] | None = None,
        sectors: tuple[str, ...] | None = None,
    ) -> list[dict]:
        del planning_year  # The source table contains fixed historical years, not planning years.
        rows = await self.repository.list_dealers(dealer_ids, sectors)
        result = []
        seen_keys: set[tuple[str, str | None]] = set()
        config = await self.workspace_repository.config() if department is not None else None
        allowed = config.department_resources if config else default_department_resources()
        for row in rows:
            code = str(row["distributor_code"])
            key = (code, row["sector"])
            if key in seen_keys:
                continue
            seen_keys.add(key)
            resources = {
                "MRD": row["mrd_2025"],
                "SP&A": row["btl_2025"],
                "ICE Rebate": row["reb_2025"],
                "Capex": row["capex_2025"],
            }
            visible = (
                set().union(*(allowed.get(dep, set()) for dep in departments(department)))
                if department is not None
                else set(resources)
            )
            history_values = {
                "vol2024": row["volume_2024"],
                "c32024": row["c3_2024"],
                "vol2025": row["volume_2025"],
                "c32025": row["c3_2025"],
                "vol2026Ytd": row["volume_2026"],
                "c32026Ytd": row["c3_2026"],
                "yield": row["yield_2025"],
            }
            history: dict[str, Any] = {
                key: float(value) if value is not None else None
                for key, value in history_values.items()
            }
            history["resources2025"] = {
                key: float(value) if value is not None else None
                for key, value in resources.items()
                if key in visible
            }
            # Absence due to authorization is different from a null source cell.
            # Expose resource names only, never the protected amounts.
            history["restrictedResources2025"] = sorted(set(resources) - visible)
            result.append(
                {
                    "id": code,
                    "name": row["distributor_name"],
                    "sector": row["sector"],
                    "history": history,
                }
            )
        return result

    async def metadata(self, planning_year: int) -> dict:
        count = await self.repository.count_dealers()
        if not count:
            return {}
        return {
            "batchId": "data.distributor_sellin_resource_history",
            "asOf": "2026",
            "planningYear": planning_year,
            "count": count,
        }
