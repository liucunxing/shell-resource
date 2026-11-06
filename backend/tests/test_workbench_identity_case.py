"""Case-insensitive identity resolution against real permission records."""

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import update

from app.dependencies.workbench_user import resolve_workbench_permission
from app.models.do.budget import BudgetDO
from app.models.do.workspace import UserPermissionDO
from app.repositories.workspace_repository import WorkspaceRepository
from test_workspace import _session


@pytest_asyncio.fixture
async def session():
    value = await _session()
    engine = value.bind
    try:
        yield value
    finally:
        await value.close()
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("stored_email", ["Example.User04@Example.Invalid", "EXAMPLE.USER04@EXAMPLE.INVALID"])
@pytest.mark.parametrize("input_email", [
    "Example.User04@Example.Invalid", "example.user04@example.invalid", "EXAMPLE.USER04@EXAMPLE.INVALID",
])
async def test_existing_mixed_case_permission_resolves_without_changing_owner_identity(
    session, stored_email, input_email,
):
    permission = await session.get(UserPermissionDO, 1)
    permission.email = stored_email
    budget = await session.get(BudgetDO, 1)
    budget.owner_email = stored_email
    await session.commit()

    user = await resolve_workbench_permission(session, input_email)

    assert user.email == stored_email
    assert user.role == "owner"
    assert user.departments == ("MKT",)
    assert user.sectors == ("PCMO",)
    rows = await WorkspaceRepository(session).list_budgets(2027, user.departments, None, user.email)
    assert [row.id for row in rows] == [1]


@pytest.mark.asyncio
@pytest.mark.parametrize("duplicate_enabled", [True, False])
@pytest.mark.parametrize("input_email", ["a@example.com", "A@EXAMPLE.COM"])
async def test_case_duplicate_permissions_fail_closed(session, duplicate_enabled, input_email):
    session.add(UserPermissionDO(
        email="A@EXAMPLE.COM", display_name="Conflicting identity", role="admin",
        department=[], sector=[], enabled=duplicate_enabled,
    ))
    await session.commit()

    with pytest.raises(HTTPException) as error:
        await resolve_workbench_permission(session, input_email)

    assert error.value.status_code == 403
    assert error.value.detail == "邮箱权限记录冲突，请联系管理员"


@pytest.mark.asyncio
async def test_disabled_mixed_case_permission_stays_denied(session):
    permission = await session.get(UserPermissionDO, 1)
    permission.email = "A@EXAMPLE.COM"
    permission.enabled = False
    await session.commit()

    with pytest.raises(HTTPException) as error:
        await resolve_workbench_permission(session, "a@example.com")

    assert error.value.status_code == 403
    assert error.value.detail == "当前邮箱没有工作台权限"


@pytest.mark.asyncio
async def test_permission_recheck_refreshes_role_in_existing_session(session):
    permission = await session.get(UserPermissionDO, 1)
    assert (await resolve_workbench_permission(session, "a@example.com")).role == "owner"
    await session.execute(
        update(UserPermissionDO).where(UserPermissionDO.id == 1).values(role="revoked"),
        execution_options={"synchronize_session": False},
    )
    assert permission.role == "owner"

    with pytest.raises(HTTPException) as error:
        await resolve_workbench_permission(session, "A@EXAMPLE.COM")

    assert error.value.status_code == 403
    assert error.value.detail == "用户权限配置无效"
