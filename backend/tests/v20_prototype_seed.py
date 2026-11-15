"""V20 permission adaptation over the preserved synthetic V19 business snapshot."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from tests.v19_prototype_seed import RESOURCES, seed_prototype, synthetic_email

from app.core.resource_access import default_department_resources, default_role_resources
from app.models.do.workspace import UserPermissionDO, WorkspaceConfigDO


async def seed_v20_prototype(session: AsyncSession, prototype: dict) -> dict:
    # The shared importer rejects non-SQLite and nonempty databases before writing.
    manifest = await seed_prototype(session, prototype)
    access = prototype["db"].get("historyAccess") or {}
    overrides = access.get("users") or {}
    source_users = {synthetic_email(user): user for user in prototype["db"]["users"]}
    for user in (await session.scalars(select(UserPermissionDO))).all():
        source = source_users[user.email]
        explicit = overrides.get(source["id"])
        # A V19 role's resolved [] was never a user's explicit denial.
        user.history_resources = (
            [RESOURCES[field] for field in explicit] if isinstance(explicit, list) else None
        )
    config = await session.get(WorkspaceConfigDO, 1)
    assert config is not None
    config.department_resources = {
        key.upper(): [RESOURCES[field] for field in fields]
        for key, fields in (access.get("departments") or {}).items()
    }
    config.role_resources = default_role_resources()
    config.reference = {**(config.reference or {}), "localPermissionBaseline": "V20"}
    await session.commit()
    manifest["permissionAdaptation"] = {
        "baseline": "V20",
        "departmentCeiling": default_department_resources(),
        "explicitUserOverrides": "preserved; no override inherits department",
        "legacyResolvedPermissionsUsedAsOverride": False,
        "businessValuesChanged": False,
        "realDatabaseAccess": False,
    }
    manifest["limitations"].append(
        "V20 reuses the original V19 synthetic business snapshot. Its full-year contract "
        "remains source metadata only, not a substitute for a same-period YTD dealer target."
    )
    return manifest
