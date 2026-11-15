"""Describe the actual history source without inventing coverage or relabelling years.

The current source is a wide annual table. It contains no business-month, contract
volume or PPP columns. A planning-year change therefore cannot manufacture a new
history snapshot. The data pipeline must supply those fields before they are used.
"""

from typing import Any

from app.core.history_policy import DEFAULT_YTD_CUTOFF_MONTH

HISTORY_SOURCE = "data.distributor_sellin_resource_history"


def history_manifest(
    planning_year: int, records: list[dict[str, Any]],
    *, ytd_cutoff_month: int = DEFAULT_YTD_CUTOFF_MONTH,
) -> dict[str, Any]:
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
        "units": {
            "source": {"volume": "L", "c3": "USD", "investment": "CNY"},
            "api": {"volume": "L", "c3": "USD", "investment": "CNY"},
            "display": {"volume": "KL", "c3": "K$", "investment": "千元人民币"},
            "displayDivisor": 1000,
        },
        "metricRules": {
            "yield": {
                "formula": "C3 / (ICE Rebate + MRD + SP&A + Capex)",
                "eligibility": "c3 > 0 and all four expenses present and totalInvestment > 0",
                "unit": "USD/CNY",
                "displaySuffix": "",
                "fxConverted": False,
                "interpretation": "历史表现参考，不是同币种回报倍数或ROI",
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
                "eligibility": "contractVolume > 0 and deliveryVolume is present",
                "contractPeriod": "full_year_signed",
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
            "ppp": {
                "defined": True,
                "kind": "target",
                "metrics": ["volume", "c3"],
                "displayUnits": {"volume": "KL", "c3": "K$"},
                "available": False,
                "unavailableReason": "missing_target_data",
                "note": (
                    "PPP 为 Vol/C3 目标；目标数据及字段映射未提供，"
                    "不能用合同量或 Actual 替代。"
                ),
            },
        },
        "asOf": None,
        "actual": {
            "source": HISTORY_SOURCE,
            "year": 2026,
            "latestMonth": None,
            "coverageStatus": "unknown",
        },
        "investment": {
            "source": HISTORY_SOURCE,
            "year": 2026,
            "latestMonth": None,
            "coverageStatus": "unknown",
        },
        "periods": [
            {"id": "2025", "year": 2025, "kind": "fullYear", "label": "2025 全年"},
            {
                "id": "2026Ytd",
                "year": 2026,
                "kind": "ytd",
                "label": "2026 YTD（截止月未提供）",
            },
        ],
        "expectedFullYear": expected_full_year,
        "expectedYtdYear": expected_ytd_year,
        "missingExpectedYears": [
            year for year in (expected_full_year, expected_ytd_year) if year not in years
        ],
        "ytdYieldComparable": False,
        "missingFields": [
            "actualBusinessMonth",
            "investmentBusinessMonth",
            "contractVolume",
            "ppp",
        ],
        "coverageNote": (
            "源表未提供 Actual 和历史费用的业务月份，"
            "YTD Yield 暂不可比较；合同量与 PPP 待接入。"
        ),
    }


def history_snapshot(
    planning_year: int, records: list[dict[str, Any]],
    *, ytd_cutoff_month: int = DEFAULT_YTD_CUTOFF_MONTH,
) -> dict[str, Any]:
    """Return the manifest and its authorized records as one API value."""
    return {
        "manifest": history_manifest(planning_year, records, ytd_cutoff_month=ytd_cutoff_month),
        "records": records,
    }
