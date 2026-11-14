from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dealer_identity import dealer_identity
from app.core.distributor_status import distributor_status
from app.core.resource_access import historical_resource_access
from app.dependencies.workbench_user import WorkbenchUser
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
        *,
        user: WorkbenchUser | None = None,
    ) -> list[dict]:
        del planning_year  # The source table contains fixed historical years, not planning years.
        if user is not None:
            sectors = user.dealer_sectors
        rows = await self.repository.list_dealers(dealer_ids, sectors)
        result = []
        # Older internal callers without an authenticated user receive public metrics only.
        config = await self.workspace_repository.config() if user is not None else None
        access = historical_resource_access(
            user,
            config.department_resources if config else None,
            config.role_resources if config else None,
        )
        visible = set(access["resources"])
        for row in rows:
            code = str(row["distributor_code"])
            resources = {
                "MRD": row["mrd_2025"],
                "SP&A": row["btl_2025"],
                "ICE Rebate": row["reb_2025"],
                "Capex": row["capex_2025"],
            }
            resources_2026 = {
                "MRD": row["mrd_2026"],
                "SP&A": row["btl_2026"],
                "ICE Rebate": row["reb_2026"],
                "Capex": row["capex_2026"],
            }
            history_values = {
                "vol2024": row["volume_2024"],
                "c32024": row["c3_2024"],
                "vol2025": row["volume_2025"],
                "c32025": row["c3_2025"],
                "vol2026Ytd": row["volume_2026"],
                "c32026Ytd": row["c3_2026"],
                "yield": None,
                "yield2026Ytd": None,
            }
            history: dict[str, Any] = {
                key: float(value) if value is not None else None
                for key, value in history_values.items()
            }
            history["ytdYieldUnavailableReason"] = "历史Actual与费用数据的业务月份尚未提供"
            for key, values in (
                ("totalInvestment2025", resources),
                ("totalInvestment2026Ytd", resources_2026),
            ):
                history[key] = (
                    float(sum(values.values()))
                    if all(value is not None for value in values.values()) else None
                )
            history["expenseAccess"] = access
            # Apply the agreed formulas to raw metrics; source ratios can disagree
            # with them. The raw database values are never changed by this projection.
            c3 = row["c3_2025"]
            investment = history["totalInvestment2025"]
            if c3 is None or investment is None:
                history["yieldUnavailableReason"] = "missing_inputs"
            elif c3 <= 0 or investment <= 0:
                history["yieldUnavailableReason"] = "non_positive_inputs"
            else:
                total = sum(Decimal(str(value)) for value in resources.values())
                history["yield"] = float(Decimal(str(c3)) / total)
                history["yieldUnavailableReason"] = None
            for key, metric in (("yoyVol2425", "volume"), ("yoyC32425", "c3")):
                base, current = row[f"{metric}_2024"], row[f"{metric}_2025"]
                reason = None
                value = None
                if base is None:
                    reason = "missing_base"
                elif base <= 0:
                    reason = "no_base"
                elif current is None:
                    reason = "missing_current"
                else:
                    base_decimal = Decimal(str(base))
                    value = float((Decimal(str(current)) - base_decimal) / base_decimal * 100)
                history[key] = value
                history[f"{key}UnavailableReason"] = reason
            history["resources2025"] = {
                key: float(value) if value is not None else None
                for key, value in resources.items()
                if key in visible
            }
            history["resources2026Ytd"] = {
                key: float(value) if value is not None else None
                for key, value in resources_2026.items()
                if key in visible
            }
            # Absence due to authorization is different from a null source cell.
            # Expose resource names only, never the protected amounts.
            history["restrictedResources2025"] = sorted(set(resources) - visible)
            history["restrictedResources2026Ytd"] = sorted(set(resources_2026) - visible)
            result.append(
                {
                    "id": dealer_identity(row),
                    "code": code,
                    "name": row["distributor_name"],
                    "sector": row["sector"],
                    "sd": row["sd"],
                    "rsm": row["rsm"],
                    "status": distributor_status(row["distributor_status"]),
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
