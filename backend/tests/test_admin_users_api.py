"""Administrator user management API, including data-level mutation guards."""

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers.workbench_controller import router
from app.core.exception_handlers import register_exception_handlers
from app.db.session import get_db_session
from app.models.do.budget import BudgetDO
from app.models.do.planning import InitiativeWorkflowDO, PlanningVersionDO
from app.models.do.workspace import UserPermissionDO
from app.services.admin_service import AdminService
from test_workspace import _session


@pytest_asyncio.fixture
async def api():
    seed = await _session()
    engine = seed.bind
    seed.add(
        UserPermissionDO(
            email="admin@example.com",
            display_name="管理员",
            role="admin",
            department=None,
            enabled=True,
        )
    )
    seed.add(
        UserPermissionDO(
            email="ice-lead@example.com",
            display_name="ICE负责人",
            role="lead",
            department="ICE",
            sector=["PCMO", "CRTO"],
            enabled=True,
        )
    )
    seed.add(
        UserPermissionDO(
            email="mkt-lead@example.com",
            display_name="MKT负责人",
            role="lead",
            department="MKT",
            sector=["PCMO"],
            enabled=True,
        )
    )
    await seed.commit()
    await seed.close()

    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(router, prefix="/api/v1/workbench")

    async def database():
        async with AsyncSession(engine, expire_on_commit=False) as session:
            yield session

    app.dependency_overrides[get_db_session] = database
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1/workbench/"
    ) as client:
        yield client, engine
    await engine.dispose()


def headers(email="admin@example.com"):
    return {"X-User-Email": email}


def payload(**overrides):
    return {
        "email": "  NEW@EXAMPLE.COM ",
        "display_name": "  新执行人  ",
        "role": "owner",
        "department": "ice",
        "sector": ["pcmo"],
        "enabled": True,
        "affiliation_sector": "PCMO",
        "affiliation_department": "ICE",
        **overrides,
    }


@pytest.mark.asyncio
async def test_user_listing_uses_one_snapshot_without_global_write_lock(api):
    client, engine = api
    statements = []

    def record_statement(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", record_statement)
    try:
        response = await client.get("admin/users", headers=headers(), params={"limit": 2})
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record_statement)
    assert response.status_code == 200
    # One identity lookup plus one coherent listing; no configuration lock and
    # no separate count, revision or lead-coverage queries.
    assert len(statements) == 2
    assert all("workspace_config" not in statement.lower() for statement in statements)
    assert all("for update" not in statement.lower() for statement in statements)
    data = response.json()["data"]
    assert data["total"] == 4 and len(data["items"]) == 2
    assert data["items"][0]["email"] == "a@example.com"
    assert data["items"][0]["has_initiatives"] is True
    assert data["lead_sectors_by_department"] == {"ICE": ["CRTO", "PCMO"], "MKT": ["PCMO"]}
    async with AsyncSession(engine) as session:
        users = list((await session.scalars(select(UserPermissionDO))).all())
        assert data["revision"] == AdminService._users_revision(users)


@pytest.mark.asyncio
async def test_user_listing_empty_pages_keep_full_revision_and_lead_coverage(api):
    client, engine = api
    full = (await client.get("admin/users", headers=headers())).json()["data"]
    for params in ({"offset": 999}, {"email": "missing"}, {"email": "%"}, {"name": "_"}):
        result = (await client.get("admin/users", headers=headers(), params=params)).json()["data"]
        assert result["items"] == []
        assert result["total"] == (full["total"] if "offset" in params else 0)
        assert result["revision"] == full["revision"]
        assert result["lead_sectors_by_department"] == full["lead_sectors_by_department"]
    async with AsyncSession(engine) as session:
        hidden_user = await session.scalar(
            select(UserPermissionDO).where(UserPermissionDO.email == "ice-lead@example.com")
        )
        hidden_user.enabled = False
        await session.commit()
    filtered = (await client.get(
        "admin/users", headers=headers(), params={"email": "admin"},
    )).json()["data"]
    assert filtered["revision"] != full["revision"]
    assert filtered["lead_sectors_by_department"] == {"MKT": ["PCMO"]}


@pytest.mark.asyncio
async def test_only_admin_can_list_or_mutate_users(api):
    client, _ = api
    for method, path, body in (
        ("GET", "admin/users", None),
        ("POST", "admin/users", payload()),
        ("PUT", "admin/users/1", payload()),
        ("DELETE", "admin/users/1", None),
    ):
        response = await client.request(method, path, headers=headers("a@example.com"), json=body)
        assert response.status_code == 403


@pytest.mark.asyncio
async def test_bulk_users_import_preview_auth_and_atomic_failure(api):
    client, _ = api
    listed = (await client.get("admin/users", headers=headers())).json()["data"]
    command = {"expected_revision": listed["revision"], "items": [payload()]}
    preview = await client.post("admin/users/import", headers=headers(), json=command)
    assert preview.status_code == 200, preview.text
    assert preview.json()["data"]["created"] == 1
    after = (await client.get("admin/users", headers=headers())).json()["data"]
    assert after["revision"] == listed["revision"] and after["total"] == listed["total"]
    denied = await client.post("admin/users/import", headers=headers("a@example.com"), json=command)
    assert denied.status_code == 403
    simulated = await client.post("admin/users/import", headers={
        **headers(), "X-Preview-User-Email": "a@example.com",
    }, json=command)
    assert simulated.status_code == 403
    invalid = {**command, "preview": False,
               "items": [payload(), payload(email="bad@example.com", sector=["B2B"])]}
    failed = await client.post("admin/users/import", headers=headers(), json=invalid)
    assert failed.status_code == 422
    after = (await client.get("admin/users", headers=headers())).json()["data"]
    assert after["revision"] == listed["revision"]
    saved = await client.post("admin/users/import", headers=headers(),
                              json={**command, "preview": False})
    assert saved.status_code == 200, saved.text
    stale = await client.post("admin/users/import", headers=headers(), json=command)
    assert stale.status_code == 409


@pytest.mark.asyncio
async def test_create_search_edit_disable_and_delete_user(api):
    client, _ = api
    created = await client.post("admin/users", headers=headers(), json=payload())
    assert created.status_code == 200, created.text
    user = created.json()["data"]
    assert (user["email"], user["display_name"], user["department"], user["sector"]) == (
        "new@example.com",
        "新执行人",
        ["ICE"],
        ["PCMO"],
    )
    user_id = user["id"]

    query = await client.get(
        "admin/users",
        headers=headers(),
        params={
            "email": "NEW",
            "name": "执行",
            "role": "owner",
            "department": "ICE",
            "sector": "PCMO",
        },
    )
    assert query.status_code == 200
    assert query.json()["data"]["total"] == 1
    assert query.json()["data"]["items"][0]["id"] == user_id
    assert query.json()["data"]["items"][0]["has_initiatives"] is False

    changed = await client.put(
        f"admin/users/{user_id}",
        headers=headers(),
        json=payload(
            email="new@example.com",
            display_name="新负责人",
            role="lead",
            sector=["CRTO", "OEM"],
            enabled=False,
        ),
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["data"]["enabled"] is False
    assert changed.json()["data"]["sector"] == ["CRTO", "OEM"]
    listed = await client.get("admin/users", headers=headers(), params={"role": "lead"})
    assert "new@example.com" in [item["email"] for item in listed.json()["data"]["items"]]
    sector_query = await client.get("admin/users", headers=headers(), params={"sector": "OEM"})
    assert [item["email"] for item in sector_query.json()["data"]["items"]] == ["new@example.com"]

    removed = await client.delete(f"admin/users/{user_id}", headers=headers())
    assert removed.status_code == 200
    assert removed.json()["data"]["deleted_id"] == user_id
    assert (await client.delete(f"admin/users/{user_id}", headers=headers())).status_code == 404


@pytest.mark.asyncio
async def test_email_is_unique_and_user_fields_are_validated(api):
    client, _ = api
    duplicate = await client.post(
        "admin/users", headers=headers(), json=payload(email=" A@EXAMPLE.COM ")
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["msg"] == "邮箱已存在"
    for bad in (
        payload(email="not-an-email"),
        payload(display_name=" "),
        payload(role="owner", department=""),
        payload(role="admin", department="MKT"),
        payload(role="invalid"),
        {**payload(), "sector": "PCMO"},
        {**payload(), "sector": []},
        {**payload(), "sector": ["PCMO", "CRTO"]},
        {**payload(role="lead"), "sector": []},
        {**payload(role="lead"), "sector": ["PCMO", "CRTO", "B2B", "OEM", "EXTRA"]},
        {**payload(), "sector": ["INVALID"]},
        {**payload(role="admin", department=None), "sector": ["PCMO"]},
    ):
        response = await client.post("admin/users", headers=headers(), json=bad)
        assert response.status_code == 422


@pytest.mark.asyncio
async def test_owner_sector_must_be_covered_by_an_enabled_department_lead(api):
    client, engine = api
    rejected = await client.post("admin/users", headers=headers(), json=payload(sector=["B2B"]))
    assert rejected.status_code == 422
    assert "未被任何启用的部门负责人覆盖" in rejected.json()["msg"]

    async with AsyncSession(engine) as session:
        lead = await session.scalar(
            select(UserPermissionDO).where(UserPermissionDO.email == "mkt-lead@example.com")
        )
        lead_id = lead.id
    changed = await client.put(
        f"admin/users/{lead_id}",
        headers=headers(),
        json={
            "email": "mkt-lead@example.com",
            "display_name": "MKT负责人",
            "role": "lead",
            "department": "MKT",
            "sector": ["CRTO"],
            "enabled": True,
        "affiliation_sector": "PCMO",
        "affiliation_department": "ICE",
        },
    )
    assert changed.status_code == 422
    assert "未被任何启用的部门负责人覆盖" in changed.json()["msg"]

    deleted = await client.delete(f"admin/users/{lead_id}", headers=headers())
    assert deleted.status_code == 422
    assert "未被任何启用的部门负责人覆盖" in deleted.json()["msg"]


@pytest.mark.asyncio
async def test_budget_owner_cannot_be_edited_or_deleted_even_if_case_differs(api):
    client, engine = api
    async with AsyncSession(engine, expire_on_commit=False) as session:
        budget = await session.get(BudgetDO, 1)
        budget.owner_email = " A@EXAMPLE.COM "
        await session.commit()
        assigned = await session.scalar(
            select(UserPermissionDO).where(UserPermissionDO.email == "a@example.com")
        )
        user_id = assigned.id
    listed = await client.get("admin/users", headers=headers(), params={"email": "a@example"})
    assert listed.json()["data"]["items"][0]["has_initiatives"] is True
    for method, body in (("PUT", payload()), ("DELETE", None)):
        response = await client.request(
            method, f"admin/users/{user_id}", headers=headers(), json=body
        )
        assert response.status_code == 409
        assert "已有 Initiative 预算事项" in response.json()["msg"]
    async with AsyncSession(engine) as session:
        assert (await session.get(UserPermissionDO, user_id)).email == "a@example.com"


@pytest.mark.asyncio
async def test_multi_department_create_search_coverage_and_legacy_input(api):
    client, engine = api
    response = await client.post(
        "admin/users", headers=headers(), json=payload(department=["mkt", " ICE "])
    )
    assert response.status_code == 200, response.text
    user = response.json()["data"]
    assert user["department"] == ["MKT", "ICE"]
    for dep in ("MKT", "ICE"):
        listed = await client.get(
            "admin/users", headers=headers(), params={"department": dep, "email": user["email"]}
        )
        assert listed.json()["data"]["total"] == 1
    for value in (["MKT", "mkt"], [], [""], [False], {"MKT": True}):
        bad = await client.post(
            "admin/users",
            headers=headers(),
            json=payload(email="invalid@example.com", department=value),
        )
        assert bad.status_code == 422
    uncovered = await client.post(
        "admin/users",
        headers=headers(),
        json=payload(email="uncovered@example.com", department=["MKT", "ICE"], sector=["CRTO"]),
    )
    assert uncovered.status_code == 422
    created = await client.post(
        "admin/budgets",
        headers=headers(),
        json={
            "planning_year": 2027,
            "items": [
                {
                    "name": "Cross department Owner",
                    "sector": "PCMO",
                    "resourceType": "MRD",
                    "department": "ICE",
                    "ownerId": user["email"],
                    "budget": 1,
                }
            ],
        },
    )
    assert created.status_code == 200, created.text
    async with AsyncSession(engine, expire_on_commit=False) as session:
        stored = await session.get(UserPermissionDO, user["id"])
        assert stored.department == ["MKT", "ICE"]


@pytest.mark.asyncio
async def test_existing_owner_can_add_department_but_not_remove_used_department(api):
    client, _ = api
    update = {
        "email": "a@example.com",
        "display_name": "A",
        "role": "owner",
        "department": ["MKT", "ICE"],
        "sector": ["PCMO"],
        "enabled": True,
        "affiliation_sector": "PCMO",
        "affiliation_department": "ICE",
    }
    response = await client.put("admin/users/1", headers=headers(), json=update)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["department"] == ["MKT", "ICE"]
    blocked = await client.put(
        "admin/users/1", headers=headers(), json={**update, "department": ["ICE"]}
    )
    assert blocked.status_code == 409
    restored = await client.put(
        "admin/users/1", headers=headers(), json={**update, "department": "MKT"}
    )
    assert restored.status_code == 200
    assert restored.json()["data"]["department"] == ["MKT"]


@pytest.mark.asyncio
async def test_edit_person_transfers_current_version_projects_atomically(api):
    client, engine = api
    async with AsyncSession(engine) as session:
        session.add(PlanningVersionDO(id="202701", name="Plan", planning_year=2027,
                                      created_by="admin@example.com"))
        for budget in (await session.scalars(select(BudgetDO))).all():
            budget.planning_version_id = "202701"
            session.add(InitiativeWorkflowDO(budget_id=budget.id, publication_id=budget.id,
                                             confirmed_publication_id=budget.id,
                                             owner_edit_locked=True))
        await session.commit()

    body = payload(email="a@example.com", display_name="A", department=["MKT"])
    transfers = [{"budget_id": 2, "owner_email": "a@example.com"},
                 {"budget_id": 1, "owner_email": "ice-lead@example.com"}]
    body["assignments"] = {"version_id": "202701", "expected_revision": 0,
                           "transfers": transfers}
    failed = await client.put("admin/users/1", json=body, headers=headers())
    assert failed.status_code == 422
    async with AsyncSession(engine) as session:
        assert (await session.get(BudgetDO, 2)).owner_email == "b@example.com"
        assert (await session.get(PlanningVersionDO, "202701")).revision == 0
        assert (await session.get(InitiativeWorkflowDO, 2)).confirmed_publication_id == 2
        assert (await session.get(UserPermissionDO, 1)).affiliation_department is None
    transfers[1]["owner_email"] = "mkt-lead@example.com"
    saved = await client.put("admin/users/1", json=body, headers=headers())
    assert saved.status_code == 200, saved.text
    async with AsyncSession(engine) as session:
        assert (await session.get(BudgetDO, 2)).owner_email == "a@example.com"
        assert (await session.get(BudgetDO, 1)).owner_email == "mkt-lead@example.com"
        assert (await session.get(UserPermissionDO, 1)).affiliation_department == "ICE"
        for budget_id in (1, 2):
            workflow = await session.get(InitiativeWorkflowDO, budget_id)
            assert workflow.requires_resubmission and workflow.confirmed_publication_id is None
    stale = await client.put("admin/users/1", json=body, headers=headers())
    assert stale.status_code == 409
