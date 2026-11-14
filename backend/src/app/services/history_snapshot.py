"""Describe the actual history source without inventing coverage or relabelling years.

The current source is a wide annual table. It contains no business-month, contract
volume or PPP columns. A planning-year change therefore cannot manufacture a new
history snapshot. The data pipeline must supply those fields before they are used.
"""

from typing import Any

HISTORY_SOURCE = "data.distributor_sellin_resource_history"


def history_manifest(planning_year: int, records: list[dict[str, Any]]) -> dict[str, Any]:
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


def history_snapshot(planning_year: int, records: list[dict[str, Any]]) -> dict[str, Any]:
    """Return the manifest and its authorized records as one API value."""
    return {"manifest": history_manifest(planning_year, records), "records": records}
