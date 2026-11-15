"""Display settings are independent of verified source coverage."""

from math import isfinite
from typing import Any

DEFAULT_YTD_CUTOFF_MONTH = 10


def configured_investment_exchange_rate(reference: dict[str, Any] | None) -> float:
    settings = (reference or {}).get("displaySettings", {})
    value = settings.get("historyInvestmentExchangeRate") if isinstance(settings, dict) else None
    if (
        isinstance(value, (int, float)) and not isinstance(value, bool)
        and isfinite(value) and value > 0
    ):
        return float(value)
    return 1.0


def configured_ytd_cutoff(reference: dict[str, Any] | None) -> int:
    settings = (reference or {}).get("displaySettings", {})
    value = settings.get("ytdCutoffMonth") if isinstance(settings, dict) else None
    if type(value) is int and 1 <= value <= 12:
        return value
    return DEFAULT_YTD_CUTOFF_MONTH
