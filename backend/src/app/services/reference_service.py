from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.reference_repository import ReferenceRepository


class ReferenceService:
    def __init__(self, session: AsyncSession) -> None:
        self.repository = ReferenceRepository(session)

    async def get_dealers(
        self, planning_year: int, department: str | None = None, dealer_ids: list[str] | None = None
    ) -> list[dict]:
        rows = await self.repository.list_dealers(planning_year, dealer_ids)
        result = []
        allowed = {"MKT": {"MRD", "SP&A"}, "ICE": {"ICE Rebate"}, "CAPEX": {"Capex"}}
        for row in rows:
            resources = {
                "MRD": row.mrd2025,
                "SP&A": row.spa2025,
                "ICE Rebate": row.ice2025,
                "Capex": row.capex2025,
            }
            total = (
                sum((value for value in resources.values() if value is not None), Decimal("0"))
                if all(v is not None for v in resources.values())
                else None
            )
            ratio = row.c32025 / total if row.c32025 is not None and total and total > 0 else None
            visible = allowed.get(department, set()) if department else set(resources)
            history_values = {
                "vol2024": row.vol2024,
                "c32024": row.c32024,
                "vol2025": row.vol2025,
                "c32025": row.c32025,
                "vol2026Ytd": row.vol2026_ytd,
                "c32026Ytd": row.c32026_ytd,
                "yield2025": ratio,
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
            result.append({"id": row.dealer_id, "name": row.dealer_name, "history": history})
        return result
