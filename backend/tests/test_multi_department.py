from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.workspace import UserPermissionDO
from app.repositories.admin_repository import AdminRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.services.insight_service import InsightService
from test_workspace import _session


def test_postgresql_department_membership_uses_array_any():
    session = SimpleNamespace(get_bind=lambda: SimpleNamespace(dialect=postgresql.dialect()))
    condition = AdminRepository(session)._department_member("ICE")
    sql = str(select(UserPermissionDO.id).where(condition).compile(dialect=postgresql.dialect()))
    assert "ANY (data.user_permissions.department)" in sql


@pytest.mark.asyncio
async def test_empty_department_scope_is_not_global():
    session = await _session()
    try:
        repository = WorkspaceRepository(session)
        assert await repository.list_budgets(2027, [], None, None) == []
        assert await repository.get_scoped_budget(1, 2027, [], None, None) is None
        assert len(await repository.list_budgets(2027, None, None, None)) == 2
    finally:
        await session.close()
        await session.bind.dispose()


def test_insight_scopes_each_authorized_department():
    service = object.__new__(InsightService)
    service.user = WorkbenchUser("lead@example.test", "lead", ["MKT", "ICE"], "Lead")
    workspace = {
        "state": {
            "initiatives": [{"id": "1", "department": "MKT"}, {"id": "2", "department": "ICE"}]
        }
    }
    assert service._scope(workspace, "ICE")["items"] == [{"id": "2", "department": "ICE"}]
    service._assert_read(service._scope(workspace, "ICE"))
    with pytest.raises(HTTPException) as denied:
        service._scope(workspace, "CAPEX")
    assert denied.value.status_code == 403
