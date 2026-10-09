"""Administrator user management API, including data-level mutation guards."""

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers.workbench_controller import router
from app.core.exception_handlers import register_exception_handlers
from app.db.session import get_db_session
from app.models.do.budget import BudgetDO
from app.models.do.workspace import UserPermissionDO
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
        **overrides,
    }


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
async def test_create_search_edit_disable_and_delete_user(api):
    client, _ = api
    created = await client.post("admin/users", headers=headers(), json=payload())
    assert created.status_code == 200, created.text
    user = created.json()["data"]
    assert (user["email"], user["display_name"], user["department"], user["sector"]) == (
        "new@example.com", "新执行人", "ICE", ["PCMO"]
    )
    user_id = user["id"]

    query = await client.get(
        "admin/users",
        headers=headers(),
        params={
            "email": "NEW", "name": "执行", "role": "owner", "department": "ICE",
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
    rejected = await client.post(
        "admin/users", headers=headers(), json=payload(sector=["B2B"])
    )
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
        },
    )
    assert changed.status_code == 422
    assert "未被任何启用的部门负责人覆盖" in changed.json()["msg"]


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
