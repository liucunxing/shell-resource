"""One server-side decision for every historical expense entry point."""

from collections.abc import Mapping
from typing import Any

RESOURCE_TYPES = ("MRD", "SP&A", "ICE Rebate", "Capex")
SECTORS = ("PCMO", "CRTO", "B2B", "OEM")
AFFILIATION_DEPARTMENTS = ("MKT", "ICE", "CAPEX")


def default_department_resources() -> dict[str, list[str]]:
    return {"MKT": ["MRD", "SP&A"], "ICE": ["ICE Rebate", "SP&A"], "CAPEX": ["Capex"]}


def default_role_resources() -> dict[str, list[str]]:
    return {
        "owner": [], "lead": [],
        "management": list(RESOURCE_TYPES), "admin": list(RESOURCE_TYPES),
    }


def historical_resource_access(
    user: object,
    department_resources: dict | None = None,
    role_resources: dict | None = None,
) -> dict:
    """Affiliation never changes row scope; explicit empty lists deny every expense column."""
    def value(name: str) -> Any:
        return user.get(name) if isinstance(user, Mapping) else getattr(user, name, None)

    sector, department = value("affiliation_sector"), value("affiliation_department")
    if sector not in SECTORS or department not in AFFILIATION_DEPARTMENTS:
        return {"source": "missing-department", "resources": []}
    override = value("history_resources")
    mapping = (
        department_resources if department_resources is not None else default_department_resources()
    )
    roles = role_resources if role_resources is not None else default_role_resources()
    if isinstance(override, (list, tuple)):
        source, resources = "user", override
    elif f"{sector}|{department}" in mapping:
        source, resources = "department", mapping[f"{sector}|{department}"]
    elif department in mapping:
        # Existing department-only configuration remains valid after migration.
        source, resources = "department", mapping[department]
    else:
        source, resources = "role", roles.get(value("role"), [])
    if not isinstance(resources, (list, tuple)):
        resources = []
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
