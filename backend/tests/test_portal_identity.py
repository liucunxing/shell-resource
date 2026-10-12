"""Portal email reuses the database-backed workbench identity boundary."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.dependencies import workbench_user
from app.models.do.workspace import UserPermissionDO
from test_workspace import _session


@pytest.mark.asyncio
async def test_portal_email_maps_to_database_admin(monkeypatch):
    lookup = AsyncMock(return_value=SimpleNamespace(
        email="lukx1@digitalchina.com", role="admin", department=None,
        display_name="Portal Admin", sector=None,
    ))
    monkeypatch.setattr(workbench_user.WorkspaceRepository, "get_permission", lookup)
    user = await workbench_user.get_current_workbench_user(
        None, " LUKX1@digitalchina.com "
    )
    lookup.assert_awaited_once_with("lukx1@digitalchina.com")
    assert user.email == "lukx1@digitalchina.com"
    assert user.role == "admin"


@pytest.mark.asyncio
async def test_unmapped_or_disabled_portal_identity_is_denied(monkeypatch):
    monkeypatch.setattr(
        workbench_user.WorkspaceRepository, "get_permission", AsyncMock(return_value=None)
    )
    with pytest.raises(HTTPException) as error:
        await workbench_user.get_current_workbench_user(None, "unknown@example.com")
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_portal_handoff_does_not_bypass_production_guard(monkeypatch):
    monkeypatch.setattr(
        workbench_user, "get_settings", lambda: SimpleNamespace(app_env="production")
    )
    with pytest.raises(HTTPException) as error:
        await workbench_user.get_current_workbench_user(None, "lukx1@digitalchina.com")
    assert error.value.status_code == 401


@pytest.mark.asyncio
async def test_disabled_database_user_cannot_enter():
    session = await _session()
    engine = session.bind
    try:
        permission = await session.scalar(select(UserPermissionDO))
        permission.enabled = False
        await session.commit()
        with pytest.raises(HTTPException) as error:
            await workbench_user.get_current_workbench_user(session, permission.email)
        assert error.value.status_code == 403
    finally:
        await session.close()
        await engine.dispose()
