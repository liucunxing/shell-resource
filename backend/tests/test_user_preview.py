"""Admin previews use target permissions without changing either login session."""

from dataclasses import dataclass
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers import data_agent_controller
from app.models.do.base import BaseDO
from app.models.do.workspace import UserPermissionDO
from app.repositories.distributor_directory_repository import DatabricksDistributorRepository
from app.services.insight_service import InsightService
from test_portal_receiver import PREFIX, Harness
from test_portal_receiver import harness as harness

ADMIN = "admin@example.com"
OWNER = "a@example.com"
PREVIEW_HEADER = "X-Preview-User-Email"
WORKSPACE = "/workspace?planning_year=2027"


@dataclass
class PreviewAPI:
    client: httpx.AsyncClient
    db: AsyncSession
    prefix: str
    actor_headers: dict[str, str]
    portal: bool

    def headers(self, target: str = OWNER) -> dict[str, str]:
        return {**self.actor_headers, PREVIEW_HEADER: target}


@pytest_asyncio.fixture(params=["legacy", "portal"])
async def preview_api(request, harness: Harness):
    harness.db.add_all([
        UserPermissionDO(email=ADMIN, role="admin", display_name="管理员", enabled=True),
        UserPermissionDO(
            email="lead@example.com", role="lead", display_name="部门负责人",
            department=["MKT"], sector=["PCMO"], enabled=True,
        ),
        UserPermissionDO(
            email="management@example.com", role="management", display_name="管理层", enabled=True,
        ),
    ])
    await harness.db.commit()
    portal = request.param == "portal"
    headers = {"X-User-Email": ADMIN}
    if portal:
        response, instance = await harness.login(ADMIN, "administrator")
        assert response.status_code == 303
        headers = await harness.headers(instance)
    yield PreviewAPI(
        harness.client, harness.db,
        (PREFIX if portal else "") + "/api/v1/workbench", headers, portal,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("target", [OWNER, "lead@example.com", "management@example.com", ADMIN])
async def test_preview_matches_real_target_and_exit_restores_admin(preview_api, target):
    api = preview_api
    direct = await api.client.get(
        "/api/v1/workbench" + WORKSPACE, headers={"X-User-Email": target},
    )
    response = await api.client.get(api.prefix + WORKSPACE, headers=api.headers(target.upper()))
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    data = response.json()["data"]
    assert data["identity"]["preview"] == {
        "readOnly": True, "actorEmail": ADMIN, "actorLabel": "管理员",
    }
    data["identity"]["preview"] = None
    assert data == direct.json()["data"]
    restored = await api.client.get(api.prefix + WORKSPACE, headers=api.actor_headers)
    assert restored.status_code == 200
    assert restored.json()["data"]["identity"]["email"] == ADMIN
    assert restored.json()["data"]["identity"]["preview"] is None


@pytest.mark.asyncio
async def test_preview_owner_cannot_read_other_owners_or_admin_apis(preview_api):
    api = preview_api
    for path, expected in (
        ("/initiatives/1/draft", 200),
        ("/initiatives/2/draft", 404),
        ("/initiatives/2/publications", 404),
        ("/admin/users", 403),
    ):
        response = await api.client.get(api.prefix + path, headers=api.headers())
        assert response.status_code == expected, response.text
    workspace = await api.client.get(api.prefix + WORKSPACE, headers=api.headers())
    assert [item["id"] for item in workspace.json()["data"]["state"]["initiatives"]] == ["1"]
    assert workspace.json()["data"]["users"] == []


@pytest.mark.asyncio
async def test_insight_read_uses_target_owner_and_rejects_another_scope(preview_api):
    api = preview_api
    path = f"/insights?planning_year=2027&scope=owner:{OWNER}"
    direct = await api.client.get(
        "/api/v1/workbench" + path, headers={"X-User-Email": OWNER},
    )
    preview = await api.client.get(api.prefix + path, headers=api.headers())
    assert preview.status_code == direct.status_code == 200, preview.text
    assert preview.json() == direct.json()
    denied = await api.client.get(
        api.prefix + "/insights?planning_year=2027&scope=owner:b@example.com",
        headers=api.headers(),
    )
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_distributor_directory_uses_target_sectors(preview_api, monkeypatch):
    api = preview_api
    permission = await api.db.scalar(
        select(UserPermissionDO).where(UserPermissionDO.email == OWNER)
    )
    permission.sector = ["CRTO"]
    await api.db.commit()
    rows = [
        {"distributor_code": "d1", "distributor_name": "PCMO Dealer", "sector": "PCMO"},
        {"distributor_code": "d3", "distributor_name": "CRTO Dealer", "sector": "CRTO"},
    ]

    async def directory(_self, sectors):
        return [row for row in rows if sectors is None or row["sector"] in sectors]

    monkeypatch.setattr(DatabricksDistributorRepository, "list_distributors", directory)
    response = await api.client.get(api.prefix + "/distributors", headers=api.headers())
    assert response.status_code == 200, response.text
    assert response.json()["data"] == [{"id": "d3", "name": "CRTO Dealer", "sector": "CRTO"}]
    restored = await api.client.get(api.prefix + "/distributors", headers=api.actor_headers)
    assert {row["id"] for row in restored.json()["data"]} == {"d1", "d3"}


@pytest.mark.asyncio
@pytest.mark.parametrize("target,expected", [
    ("unknown@example.com", 403),
    ("disabled@example.com", 403),
    ("forbidden@example.com", 403),
    ("", 400),
    ("not-an-email", 400),
    (OWNER + ",b@example.com", 400),
])
async def test_unavailable_or_invalid_targets_fail_closed(preview_api, target, expected):
    api = preview_api
    response = await api.client.get(api.prefix + WORKSPACE, headers=api.headers(target))
    assert response.status_code == expected
    assert response.json()["data"] is None


@pytest.mark.asyncio
async def test_duplicate_target_headers_fail_closed(preview_api):
    api = preview_api
    response = await api.client.get(
        api.prefix + WORKSPACE,
        headers=[*api.headers().items(), (PREVIEW_HEADER, "b@example.com")],
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_portal_ignores_forged_actor_headers(harness):
    _, instance = await harness.login()
    headers = await harness.headers(instance)
    response = await harness.client.get(
        PREFIX + "/api/v1/workbench" + WORKSPACE,
        headers={**headers, "X-User-Email": ADMIN, PREVIEW_HEADER: "b@example.com"},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_preview_header_does_not_authenticate_or_promote_legacy_user(harness):
    for headers, expected in (
        ({PREVIEW_HEADER: OWNER}, 401),
        ({"X-User-Email": OWNER, PREVIEW_HEADER: ADMIN}, 403),
    ):
        response = await harness.client.get("/api/v1/workbench" + WORKSPACE, headers=headers)
        assert response.status_code == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("subject,change", [
    (ADMIN, "disabled"), (ADMIN, "demoted"), (OWNER, "disabled"), (OWNER, "deleted"),
])
async def test_every_request_rechecks_actor_and_target_permissions(preview_api, subject, change):
    api = preview_api
    assert (await api.client.get(api.prefix + WORKSPACE, headers=api.headers())).status_code == 200
    permission = await api.db.scalar(
        select(UserPermissionDO).where(UserPermissionDO.email == subject)
    )
    if change == "disabled":
        permission.enabled = False
    elif change == "demoted":
        permission.role = "management"
    else:
        await api.db.delete(permission)
    await api.db.commit()
    response = await api.client.get(api.prefix + WORKSPACE, headers=api.headers())
    expected = 401 if api.portal and change == "demoted" else 403
    assert response.status_code == expected
    assert response.json()["data"] is None


@pytest.mark.asyncio
async def test_target_scope_changes_apply_on_next_request(preview_api):
    api = preview_api
    permission = await api.db.scalar(
        select(UserPermissionDO).where(UserPermissionDO.email == OWNER)
    )
    permission.department = ["ICE"]
    await api.db.commit()
    response = await api.client.get(api.prefix + WORKSPACE, headers=api.headers())
    assert response.status_code == 200
    assert response.json()["data"]["identity"]["department"] == ["ICE"]
    assert response.json()["data"]["state"]["initiatives"] == []


async def snapshot(db: AsyncSession) -> dict:
    return {
        table.name: [tuple(row) for row in (await db.execute(select(table))).all()]
        for table in BaseDO.metadata.sorted_tables if table.schema == "data"
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path,body", [
    ("PUT", "/initiatives/1/draft", {"expected_revision": 0, "rows": []}),
    ("POST", "/initiatives/1/publish", {"expected_revision": 0}),
    ("POST", "/initiatives/1/distributor-allocations", {}),
    ("PATCH", "/initiatives/1/distributor-allocations/1", {}),
    ("DELETE", "/initiatives/1/distributor-allocations/1", None),
    ("POST", "/initiatives/1/distributor-allocations/import", None),
    ("PUT", "/admin/budgets", {}),
    ("POST", "/admin/budgets", {}),
    ("PUT", "/admin/budgets/1", {}),
    ("DELETE", "/admin/budgets/1", {}),
    ("POST", "/admin/budgets/import", {}),
    ("POST", "/admin/users", {}),
    ("PUT", "/admin/users/1", {}),
    ("DELETE", "/admin/users/1", None),
    ("PUT", "/admin/config", {}),
    ("POST", "/admin/reference", {}),
    ("PUT", "/insights/prompt", {}),
    ("POST", "/insights/generate", {"scope": "global", "planning_year": 2027}),
    ("POST", "/insights/preview", {
        "scope": "global", "planning_year": 2027, "user_email": "management@example.com",
    }),
])
async def test_preview_rejects_writes_without_mutation(
    preview_api, monkeypatch, method, path, body,
):
    api = preview_api
    generate = AsyncMock(return_value={})
    monkeypatch.setattr(InsightService, "generate", generate)
    before = await snapshot(api.db)
    response = await api.client.request(
        method, api.prefix + path, headers=api.headers(ADMIN), json=body,
    )
    assert response.status_code == 403, response.text
    assert "仅供查看" in response.json()["msg"]
    assert await snapshot(api.db) == before
    generate.assert_not_awaited()


@pytest.mark.asyncio
async def test_admin_target_cannot_nest_insight_preview(preview_api):
    api = preview_api
    response = await api.client.get(
        api.prefix + "/insights/preview?user_email=a@example.com&planning_year=2027",
        headers=api.headers(ADMIN),
    )
    assert response.status_code == 403
    assert "退出模拟" in response.json()["msg"]


@pytest.mark.asyncio
async def test_preview_cannot_launch_data_agent(preview_api, monkeypatch):
    api = preview_api
    exchange = AsyncMock(return_value="https://vendor.example.invalid/")
    monkeypatch.setattr(data_agent_controller, "exchange_data_agent_ticket", exchange)
    response = await api.client.post(api.prefix + "/data-agent/launch", headers=api.headers())
    # The Portal receiver deliberately has no direct Data Agent launch endpoint.
    assert response.status_code == (404 if api.portal else 403)
    exchange.assert_not_awaited()
