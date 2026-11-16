from decimal import Decimal
from math import isfinite
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dealer_identity import dealer_identity
from app.core.distributor_status import distributor_status
from app.core.history_policy import (
    configured_investment_exchange_rate,
    verified_dealer_target_coverage,
    verified_history_coverage,
)
from app.core.resource_access import historical_resource_access
from app.dependencies.workbench_user import WorkbenchUser
from app.repositories.reference_repository import ReferenceRepository
from app.repositories.workspace_repository import WorkspaceRepository


class ReferenceService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repository = ReferenceRepository(session)
        self.workspace_repository = WorkspaceRepository(session)
        self.coverage: dict[str, Any] | None = None
        self.coverage_confirmation_status = "not_configured"
        self.target_coverage: dict[str, Any] | None = None
        self.target_confirmation_status = "not_configured"

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
        result = []
        # Older internal callers without an authenticated user receive public metrics only.
        config = (
            await self.workspace_repository.config()
            if self.session is not None or user is not None else None
        )
        reference = config.reference if config else None
        has_coverage_confirmation = isinstance(
            (reference or {}).get("historyCoverageConfirmation"), dict,
        )
        has_target_confirmation = isinstance(
            (reference or {}).get("dealerTargetConfirmation"), dict,
        )
        if has_coverage_confirmation or has_target_confirmation:
            rows = await self.repository.list_dealers(
                dealer_ids, sectors, include_source_fingerprint=True,
            )
            self.coverage = verified_history_coverage(
                reference, rows[0].get("_source_fingerprint") if rows else None,
            )
            self.coverage_confirmation_status = (
                "verified" if self.coverage else "expired" if has_coverage_confirmation
                else "not_configured"
            )
            self.target_coverage = verified_dealer_target_coverage(
                reference, rows[0].get("_source_fingerprint") if rows else None,
            )
            self.target_confirmation_status = (
                "verified" if self.target_coverage else "expired" if has_target_confirmation
                else "not_configured"
            )
        else:
            rows = await self.repository.list_dealers(dealer_ids, sectors)
            self.coverage = None
            self.coverage_confirmation_status = "not_configured"
            self.target_coverage = None
            self.target_confirmation_status = "not_configured"
        rate = Decimal(str(configured_investment_exchange_rate(
            config.reference if config else None,
        )))
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
            # Normalize once on read; keep signed expenses and source nulls intact.
            resources = {
                key: Decimal(str(value)) / rate if value is not None else None
                for key, value in resources.items()
            }
            resources_2026 = {
                key: Decimal(str(value)) / rate if value is not None else None
                for key, value in resources_2026.items()
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
            history.update(self._target_history(row))
            history["ytdYieldUnavailableReason"] = "历史Actual与费用数据的业务月份尚未提供"
            if self.coverage:
                history["actualThroughMonth"] = self.coverage["actualThroughMonth"]
                history["investmentThroughMonth"] = self.coverage["investmentThroughMonth"]
                history["ytdYieldUnavailableReason"] = (
                    None if self.coverage["actualThroughMonth"]
                    == self.coverage["investmentThroughMonth"]
                    else "历史Actual与费用的累计截止月份不一致"
                )
            history["investmentCurrency"] = "USD"
            history["investmentExchangeRate"] = float(rate)
            for key, values in (
                ("totalInvestment2025", resources),
                ("totalInvestment2026Ytd", resources_2026),
            ):
                history[key] = (
                    float(sum(values.values()))
                    if all(value is not None for value in values.values()) else None
                )
            ytd_c3, ytd_investment = row["c3_2026"], history["totalInvestment2026Ytd"]
            if (
                not history["ytdYieldUnavailableReason"]
                and ytd_c3 is not None and ytd_c3 > 0
                and ytd_investment is not None and ytd_investment > 0
            ):
                history["yield2026Ytd"] = float(Decimal(str(ytd_c3)) / Decimal(str(ytd_investment)))
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

    def _target_history(self, row: Any) -> dict[str, Any]:
        result: dict[str, Any] = {
            "targetSourceUnit": (
                self.target_coverage["sourceUnit"] if self.target_coverage else None
            ),
            "targetSourceFields": {},
            "phasingSourceFields": {},
        }
        for year, suffix in (("2025", "2025"), ("2026", "2026Ytd")):
            raw_target = row.get(f"target_{year}")
            raw_phasing = row.get(f"phasing_{year}")
            present = bool(row.get(f"_has_target_{year}", raw_target is not None))
            result["targetSourceFields"][suffix] = present
            result[f"sourceTarget{suffix}"] = (
                float(raw_target) if raw_target is not None else None
            )
            # Source ratios are the business-authoritative Phasing values. They
            # do not depend on independently confirmed target units or periods.
            result["phasingSourceFields"][suffix] = bool(
                row.get(f"_has_phasing_{year}", raw_phasing is not None)
            )
            phasing = float(raw_phasing) if raw_phasing is not None else None
            phasing_reason = "missing_source_phasing" if phasing is None else None
            if phasing is not None and not isfinite(phasing):
                phasing, phasing_reason = None, "invalid_source_phasing"
            result[f"sourcePhasing{suffix}"] = phasing
            result[f"phasing{suffix}"] = phasing
            result[f"phasing{suffix}UnavailableReason"] = phasing_reason
            reason = None
            if not present:
                reason = "missing_target_source_field"
            elif not self.target_coverage:
                reason = (
                    "target_confirmation_expired" if self.target_confirmation_status == "expired"
                    else "target_unit_period_unconfirmed"
                )
            elif year == "2026" and not self.coverage:
                reason = "actual_period_unconfirmed"
            elif year == "2026" and self.coverage and (
                self.target_coverage["periods"][year]["endMonth"]
                != self.coverage["actualThroughMonth"]
            ):
                reason = "target_actual_period_mismatch"
            elif raw_target is None:
                reason = "missing_target"
            elif not Decimal(str(raw_target)).is_finite():
                reason = "invalid_target"
            target = None
            if not reason and self.target_coverage:
                # Known non-positive targets remain distinct from unknown values;
                # paired Phasing aggregation excludes them, without poisoning all
                # other eligible rows. Unit/period gates still apply before this.
                target = float(Decimal(str(raw_target)) * (
                    1000 if self.target_coverage["sourceUnit"] == "KL" else 1
                ))
            result[f"contract{suffix}"] = target
            result[f"target{suffix}UnavailableReason"] = reason
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
