"""Describe the actual history source without inventing coverage or relabelling years.

The current source is a wide annual table. It contains no business-month or dealer
target/contract-volume columns. A planning-year change therefore cannot manufacture a new
history snapshot. The data pipeline must supply those fields before they are used.
"""

from typing import Any

from app.core.history_policy import DEFAULT_YTD_CUTOFF_MONTH

HISTORY_SOURCE = "data.distributor_sellin_resource_history"


def history_manifest(
    planning_year: int, records: list[dict[str, Any]],
    *, ytd_cutoff_month: int = DEFAULT_YTD_CUTOFF_MONTH,
    investment_exchange_rate: float = 1.0,
    coverage: dict[str, Any] | None = None,
    coverage_confirmation_status: str = "not_configured",
) -> dict[str, Any]:
    actual_month = coverage["actualThroughMonth"] if coverage else None
    investment_month = coverage["investmentThroughMonth"] if coverage else None
    comparable = bool(coverage and actual_month == investment_month)
    effective_month = (
        actual_month if coverage else None if coverage_confirmation_status == "expired"
        else ytd_cutoff_month
    )
    years = [
        year
        for year, fields in (
            (2024, ("vol2024", "c32024")),
            (2025, ("vol2025", "c32025", "totalInvestment2025")),
            (2026, ("vol2026Ytd", "c32026Ytd", "totalInvestment2026Ytd")),
        )
        if any(
            record.get("history", {}).get(field) is not None
            for record in records
            for field in fields
        )
    ]
    expected_full_year = planning_year - 2
    expected_ytd_year = planning_year - 1
    return {
        "schemaVersion": 1,
        "batchId": HISTORY_SOURCE,
        "source": HISTORY_SOURCE,
        "planningYear": planning_year,
        "count": len(records),
        "availableYears": years,
        "priorYear": 2024,
        "fullYear": 2025,
        "ytdYear": 2026,
        "configuredYtdCutoffMonth": ytd_cutoff_month,
        "configuredPeriodLabel": f"2026 YTD（1–{ytd_cutoff_month}月）",
        "configuredMonthIsCoverageEvidence": False,
        "effectiveYtdCutoffMonth": effective_month,
        "coverageConfirmationStatus": coverage_confirmation_status,
        "coverageConfirmation": coverage,
        "sourcePeriodMetadataAvailable": False,
        "units": {
            "source": {
                "volume": "L", "c3": "USD",
                "investment": (
                    "USD" if investment_exchange_rate == 1 else "configured_source_currency"
                ),
            },
            "api": {"volume": "L", "c3": "USD", "investment": "USD"},
            "display": {"volume": "KL", "c3": "K$", "investment": "K$"},
            "displayDivisor": 1000,
        },
        "investmentConversion": {
            "rate": investment_exchange_rate,
            "formula": "sourceInvestment / rate = investmentUSD",
            "targetCurrency": "USD",
            "scope": "all historical expense years and categories",
            "planningCurrency": "CNY",
            "planningConversionApplied": False,
            "negativeExpenses": "signed_net_sum",
        },
        "metricRules": {
            "yield": {
                "formula": "C3 / (ICE Rebate + MRD + SP&A + Capex)",
                "eligibility": "c3 > 0 and all four expenses present and totalInvestment > 0",
                "unit": "USD/USD",
                "displaySuffix": "",
                "fxConverted": investment_exchange_rate != 1,
                "interpretation": "美元口径的历史表现参考，不是未来ROI",
                "sourceYieldUsed": False,
            },
            "yoy": {
                "formula": "(value2025 - value2024) / value2024 * 100",
                "metrics": ["volume", "c3"],
                "unit": "percent",
                "nonPositiveBaseReason": "no_base",
                "nonPositiveBaseLabel": "无基期",
            },
            "phasing": {
                "formula": "deliveryVolume / contractVolume * 100",
                "eligibility": (
                    "contractVolume > 0 and deliveryVolume is present "
                    "and dealer target covers the same year/months as actual"
                ),
                "contractPeriod": "same_period_as_actual",
                "targetKind": "dealer_volume_target",
                "periodRule": "YTD actual through month N requires dealer target for months 1-N",
                "unit": "percent",
                "reference": "sum(deliveryVolume) / sum(contractVolume) for eligible rows",
                "trafficLight": {
                    "relativeYellowBand": 0.1,
                    "aboveBand": "green",
                    "belowBand": "red",
                },
                "available": False,
                "unavailableReason": "missing_contract_volume",
            },
        },
        "asOf": None,
        "actual": {
            "source": HISTORY_SOURCE,
            "year": 2026,
            "latestMonth": actual_month,
            "startMonth": 1 if coverage else None,
            "coverageStatus": "business_confirmed" if coverage else "unknown",
        },
        "investment": {
            "source": HISTORY_SOURCE,
            "year": 2026,
            "latestMonth": investment_month,
            "startMonth": 1 if coverage else None,
            "coverageStatus": "business_confirmed" if coverage else "unknown",
        },
        "periods": [
            {"id": "2025", "year": 2025, "kind": "fullYear", "label": "2025 全年"},
            {
                "id": "2026Ytd",
                "year": 2026,
                "kind": "ytd",
                "label": (
                    f"2026 YTD（1–{actual_month}月）" if coverage
                    else "2026 YTD（截止月待确认）"
                ),
            },
        ],
        "expectedFullYear": expected_full_year,
        "expectedYtdYear": expected_ytd_year,
        "missingExpectedYears": [
            year for year in (expected_full_year, expected_ytd_year) if year not in years
        ],
        "ytdYieldComparable": comparable,
        "missingSourceFields": [
            "actualBusinessMonth",
            "investmentBusinessMonth",
            "contractVolume",
        ],
        "missingFields": ["contractVolume"] if coverage else [
            "actualBusinessMonth", "investmentBusinessMonth", "contractVolume",
        ],
        "coverageNote": (
            f"本源批次已由业务确认：2026年Actual累计1–{actual_month}月、"
            f"费用累计1–{investment_month}月；源时间字段仍待补。"
            + ("同期Yield可计算；" if comparable else "累计期间不一致，Yield暂不可比较；")
            + "经销商同期target（合同量）待接入。"
            if coverage else
            "源表未提供 Actual 和历史费用的业务月份，"
            "YTD Yield 暂不可比较；经销商同期 target（合同量）待接入。"
        ),
    }


def history_snapshot(
    planning_year: int, records: list[dict[str, Any]],
    *, ytd_cutoff_month: int = DEFAULT_YTD_CUTOFF_MONTH,
    investment_exchange_rate: float = 1.0,
    coverage: dict[str, Any] | None = None,
    coverage_confirmation_status: str = "not_configured",
) -> dict[str, Any]:
    """Return the manifest and its authorized records as one API value."""
    return {
        "manifest": history_manifest(
            planning_year, records, ytd_cutoff_month=ytd_cutoff_month,
            investment_exchange_rate=investment_exchange_rate,
            coverage=coverage, coverage_confirmation_status=coverage_confirmation_status,
        ),
        "records": records,
    }
