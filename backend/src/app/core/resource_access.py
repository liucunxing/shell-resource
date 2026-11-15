"""One server-side decision for every historical expense entry point."""

from collections.abc import Mapping
from typing import Any

RESOURCE_TYPES = ("MRD", "SP&A", "ICE Rebate", "Capex")
SECTORS = ("PCMO", "CRTO", "B2B", "OEM")
AFFILIATION_DEPARTMENTS = ("MKT", "ICE", "CAPEX")


def default_department_resources() -> dict[str, list[str]]:
    return {"MKT": ["MRD", "SP&A"], "ICE": ["ICE Rebate", "SP&A"], "CAPEX": ["Capex"]}


def default_role_resources() -> dict[str, list[str]]:
    # Kept in the configuration DTO for backwards compatibility, never an access grant.
    return {role: [] for role in ("owner", "lead", "management", "admin")}


def historical_resource_access(
    user: object,
    department_resources: dict | None = None,
    role_resources: dict | None = None,
) -> dict:
    """Department is the ceiling; department/user configuration can only narrow it.

    Business row scope and role are deliberately not expense-column grants. Existing
    role configuration is accepted for API compatibility but never widens the ceiling.
    Explicit empty or malformed configuration fails closed.
    """
    del role_resources
    def value(name: str) -> Any:
        return user.get(name) if isinstance(user, Mapping) else getattr(user, name, None)

    sector, department = value("affiliation_sector"), value("affiliation_department")
    if sector not in SECTORS or department not in AFFILIATION_DEPARTMENTS:
        return {"source": "missing-department", "resources": []}
    ceiling = default_department_resources()[department]
    mapping = (
        department_resources if department_resources is not None else default_department_resources()
    )
    configured = mapping.get(f"{sector}|{department}", mapping.get(department, ceiling))
    resources = (
        [key for key in ceiling if key in configured]
        if isinstance(configured, (list, tuple)) else []
    )
    source = "department"
    override = value("history_resources")
    if override is not None:
        source = "user"
        resources = (
            [key for key in resources if key in override]
            if isinstance(override, (list, tuple)) else []
        )
    return {"source": source, "resources": [key for key in RESOURCE_TYPES if key in resources]}


def validate_submission_reasons(reasons: list[dict], rows: list) -> None:
    """Disabled/unknown fixed reasons cannot become a new submitted snapshot."""
    allowed = {item.get("id") for item in reasons if item.get("enabled") is True}
    for row in rows:
        reason_id = (
            row.get("reasonId") if isinstance(row, dict) else getattr(row, "reason_id", None)
        )
        if reason_id not in allowed:
            raise ValueError("预留原因已停用或不存在，请选择启用的固定原因后提交")
