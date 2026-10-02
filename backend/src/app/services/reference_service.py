from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.reference_repository import ReferenceRepository


class ReferenceService:
    def __init__(self, session: AsyncSession) -> None:
        self.repository = ReferenceRepository(session)

    async def get_dealers(
        self, planning_year: int, department: str | None = None, dealer_ids: list[str] | None = None
    ) -> list[dict]:
        del planning_year  # The source table contains fixed historical years, not planning years.
        rows = await self.repository.list_dealers(dealer_ids)
        result = []
        seen_codes: set[str] = set()
        allowed = {"MKT": {"MRD", "SP&A"}, "ICE": {"ICE Rebate"}, "CAPEX": {"Capex"}}
        for row in rows:
            code = str(row["distributor_code"])
            if code in seen_codes:
                continue
            seen_codes.add(code)
            resources = {
                "MRD": row["mrd_2025"],
                "SP&A": row["btl_2025"],
                "ICE Rebate": row["reb_2025"],
                "Capex": row["capex_2025"],
            }
            visible = allowed.get(department, set()) if department else set(resources)
            history_values = {
                "vol2024": row["volume_2024"],
                "c32024": row["c3_2024"],
                "vol2025": row["volume_2025"],
                "c32025": row["c3_2025"],
                "vol2026Ytd": row["volume_2026"],
                "c32026Ytd": row["c3_2026"],
                "yield2025": row["yield_2025"],
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
            result.append(
                {
                    "id": code,
                    "name": row["distributor_name"],
                    "history": history,
                }
            )
        return result

    async def get_directory(self) -> list[dict]:
        rows = await self.repository.list_directory()
        result = []
        seen_codes: set[str] = set()
        for row in rows:
            code = str(row["distributor_code"])
            if code in seen_codes:
                continue
            seen_codes.add(code)
            result.append({"id": code, "name": row["distributor_name"], "history": {}})
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
