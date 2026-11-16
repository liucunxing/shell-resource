"""Display settings are independent of verified source coverage."""

import re
from datetime import datetime
from math import isfinite
from typing import Any

DEFAULT_YTD_CUTOFF_MONTH = 10


def verified_dealer_target_coverage(
    reference: dict[str, Any] | None, source_fingerprint: str | None,
) -> dict[str, Any] | None:
    """Target units and periods require a separate, exact-batch confirmation."""
    value = (reference or {}).get("dealerTargetConfirmation")
    if not isinstance(value, dict) or not source_fingerprint:
        return None
    if (
        not re.fullmatch(r"[0-9a-f]{32}", source_fingerprint)
        or value.get("sourceFingerprint") != source_fingerprint
        or value.get("sourceUnit") not in ("L", "KL")
    ):
        return None
    try:
        confirmed_at = datetime.fromisoformat(value.get("confirmedAt", ""))
    except (TypeError, ValueError):
        return None
    if confirmed_at.tzinfo is None:
        return None
    periods = value.get("periods")
    if not isinstance(periods, dict) or set(periods) != {"2025", "2026"}:
        return None
    normalized = {}
    for year in ("2025", "2026"):
        period = periods[year]
        if not isinstance(period, dict):
            return None
        start, end = period.get("startMonth"), period.get("endMonth")
        if type(start) is not int or start != 1 or type(end) is not int or not 1 <= end <= 12:
            return None
        if year == "2025" and end != 12:
            return None
        normalized[year] = {"startMonth": start, "endMonth": end}
    return {
        "sourceFingerprint": source_fingerprint,
        "sourceUnit": value["sourceUnit"],
        "periods": normalized,
        "confirmedAt": value["confirmedAt"],
    }


def verified_history_coverage(
    reference: dict[str, Any] | None, source_fingerprint: str | None,
    history_fingerprint: str | None = None,
) -> dict[str, Any] | None:
    """Validate the explicitly recorded scope, never silently reinterpret old digests."""
    value = (reference or {}).get("historyCoverageConfirmation")
    if not isinstance(value, dict):
        return None
    scope = value.get("sourceFingerprintScope")
    if scope not in (None, "history_2026_v1"):
        return None
    digest = history_fingerprint if scope == "history_2026_v1" else source_fingerprint
    if not digest:
        return None
    if (
        value.get("sourceFingerprint") != digest
        or not re.fullmatch(r"[0-9a-f]{32}", digest)
        or value.get("year") != 2026
        or type(value.get("year")) is not int
        or value.get("startMonth") != 1
        or type(value.get("startMonth")) is not int
        or not isinstance(value.get("confirmedAt"), str)
        or not value["confirmedAt"].strip()
    ):
        return None
    for key in ("actualThroughMonth", "investmentThroughMonth"):
        if type(value.get(key)) is not int or not 1 <= value[key] <= 12:
            return None
    verified = {
        key: value[key] for key in (
            "sourceFingerprint", "year", "startMonth", "actualThroughMonth",
            "investmentThroughMonth", "confirmedAt",
        )
    }
    if scope is not None:
        verified["sourceFingerprintScope"] = scope
    return verified


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
