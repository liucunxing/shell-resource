"""Lifecycle API regressions against isolated SQLite, without business-data writes."""

from contextlib import asynccontextmanager
from copy import deepcopy

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers.planning_controller import router as planning_router
from app.controllers.workbench_controller import router as workbench_router
from app.db.session import get_db_session
from app.models.do.budget import BudgetDO
from app.models.do.budget_distributor import BudgetDistributorDO
from app.models.do.planning import InitiativeWorkflowDO
from app.models.do.workspace import UserPermissionDO, WorkspacePublicationDO
from app.repositories.workspace_repository import WorkspaceRepository
from test_planning_workflow import act, prepare, submit


def headers(email):
    return {"X-User-Email": email}


ADMIN = headers("admin@example.com")
OWNER = headers("a@example.com")
LEAD = headers("lead@example.com")
MANAGEMENT = headers("exec@example.com")


async def business_snapshot(session):
    result = {}
    for model in (BudgetDO, BudgetDistributorDO, InitiativeWorkflowDO, WorkspacePublicationDO):
        items = (await session.scalars(select(model))).all()
        result[model.__name__] = deepcopy([
            {column.name: getattr(item, column.name) for column in model.__table__.columns}
            for item in items
        ])
    return result


@asynccontextmanager
async def scenario(owner_role="owner", confirmed=False):
    seed, admin, budgets = await prepare()
    engine = seed.bind
    for budget in budgets:
        await submit(seed, budget)
    if confirmed:
        await act(seed, "confirm")
    permission = await seed.get(UserPermissionDO, 1)
    permission.role = owner_role
    seed.add_all([
        UserPermissionDO(
            id=index, email=email, display_name=role, role=role,
            department=["MKT"], sector=["PCMO"], enabled=True,
        )
        for index, email, role in [
            (2, "admin@example.com", "admin"), (3, "lead@example.com", "lead"),
            (4, "exec@example.com", "management"),
        ]
    ])
    await seed.commit()
    version = await admin.version("202701")
    row = (await WorkspaceRepository(seed).rows_for(budgets[0].id))[0]
    info = {
        "budget_id": budgets[0].id, "budget_revision": budgets[0].revision,
        "version_revision": version.revision, "allocation_id": row.id,
        "business": await business_snapshot(seed),
    }
    await seed.close()
    app = FastAPI()
    app.include_router(planning_router, prefix="/api/v1/workbench")
    app.include_router(workbench_router, prefix="/api/v1/workbench")

    async def database():
        async with AsyncSession(engine, expire_on_commit=False) as session:
            yield session

    app.dependency_overrides[get_db_session] = database
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1/workbench/",
        ) as client:
            yield client, engine, info
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("owner_role", ["owner", "lead"])
@pytest.mark.parametrize("confirmed", [False, True])
async def test_stop_preserves_role_scoped_visibility_and_blocks_all_allocation_writes(
    owner_role, confirmed,
):
    async with scenario(owner_role, confirmed) as (client, engine, info):
        stopped = await client.patch("planning-versions/202701", headers=ADMIN, json={
            "expected_revision": info["version_revision"], "open": False,
        })
        assert stopped.status_code == 200
        version = stopped.json()["data"]
        assert version["published"] and not version["open"]
        initiative = f"initiatives/{info['budget_id']}"
        for identity in (OWNER, LEAD, MANAGEMENT, ADMIN):
            versions = await client.get("planning-versions?planning_year=2027", headers=identity)
            assert versions.status_code == 200 and versions.json()["data"][0]["id"] == "202701"
            read = await client.get(
                "workspace?planning_year=2027&version_id=202701", headers=identity,
            )
            assert read.status_code == 200
            state = read.json()["data"]["state"]
            assert state["initiatives"]
            assert all(not item["workflow"]["editable"] for item in state["initiatives"])
            if identity != MANAGEMENT or confirmed:
                assert all(item["rows"] for item in state["initiatives"])
            else:
                assert all(not item["rows"] for item in state["initiatives"])
            if identity == OWNER and owner_role == "lead":
                assert len(state["ownInitiatives"]) == 1
                assert not state["ownInitiatives"][0]["workflow"]["editable"]
            saved = await client.put(f"{initiative}/draft", headers=identity, json={
                "expected_revision": info["budget_revision"],
                "rows": [{"dealerId": "d1", "amount": 5}],
            })
            assert saved.status_code in {403, 409}
            published = await client.post(f"{initiative}/publish", headers=identity, json={
                "expected_revision": info["budget_revision"],
            })
            assert published.status_code in {403, 409}
        department = await client.get(
            "planning-versions/202701/department?sector=PCMO&department=MKT", headers=LEAD,
        )
        assert department.status_code == 200
        assert not department.json()["data"]["canConfirm"]
        assert not department.json()["data"]["canWithdraw"]
        for action in ("confirm", "withdraw"):
            result = await client.post(f"planning-versions/202701/department/{action}",
                                      headers=LEAD, json={
                                          "expected_revision": version["revision"],
                                          "sector": "PCMO", "department": "MKT", "reason": "review",
                                      })
            assert result.status_code == 409
        # Old per-row and Excel routes must not bypass whole-draft/version guards.
        allocations = f"{initiative}/distributor-allocations"
        assert (await client.post(allocations, headers=OWNER, json={
            "distributor_code": "d2", "distributor_budget_amount": 5,
        })).status_code == 409
        assert (await client.patch(f"{allocations}/{info['allocation_id']}", headers=OWNER,
                                 json={"distributor_budget_amount": 5})).status_code == 409
        assert (await client.delete(f"{allocations}/{info['allocation_id']}",
                                    headers=OWNER)).status_code == 409
        assert (await client.post(f"{allocations}/import", headers=OWNER, files={
            "file": ("allocation.xlsx", b"unused-because-version-is-locked"),
        })).status_code == 409
        async with AsyncSession(engine) as session:
            assert await business_snapshot(session) == info["business"]
        enabled = await client.patch("planning-versions/202701", headers=ADMIN, json={
            "expected_revision": version["revision"], "published": True, "open": True,
        })
        assert enabled.status_code == 200
        draft = await client.get(f"{initiative}/draft", headers=OWNER)
        assert draft.status_code == 200
        assert draft.json()["data"]["workflow"]["editable"] is not confirmed
        assert draft.json()["data"]["workflow"]["confirmed"] is confirmed
        async with AsyncSession(engine) as session:
            assert await business_snapshot(session) == info["business"]


@pytest.mark.asyncio
async def test_visibility_cannot_be_revoked_by_editing_enabled_version_and_removal_is_distinct():
    async with scenario() as (client, engine, info):
        hidden = await client.patch("planning-versions/202701", headers=ADMIN, json={
            "expected_revision": info["version_revision"], "published": False, "open": False,
            "name": "must not change",
        })
        assert hidden.status_code == 409
        assert "停用" in hidden.json()["detail"]
        listed = (await client.get("planning-versions?planning_year=2027", headers=OWNER)).json()[
            "data"
        ]
        assert listed[0]["open"] and listed[0]["name"] == "年度规划"
        assert listed[0]["revision"] == info["version_revision"]
        stopped = await client.patch("planning-versions/202701", headers=ADMIN, json={
            "expected_revision": info["version_revision"], "open": False,
        })
        revision = stopped.json()["data"]["revision"]
        deleted = await client.post("planning-versions/202701/delete", headers=ADMIN,
                                       json={"expected_revision": revision})
        assert deleted.status_code == 409
        assert "勾选确认" in deleted.json()["detail"]
        deleted = await client.post("planning-versions/202701/delete", headers=ADMIN,
                                       json={"expected_revision": revision,
                                             "confirm_submitted": True})
        assert deleted.status_code == 200
        initiative = f"initiatives/{info['budget_id']}"
        for identity in (OWNER, LEAD, MANAGEMENT, ADMIN):
            assert (await client.get("planning-versions?planning_year=2027", headers=identity)
                    ).json()["data"] == []
            read = await client.get(
                "workspace?planning_year=2027&version_id=202701", headers=identity,
            )
            assert read.status_code == 404
        assert (await client.get(f"{initiative}/draft", headers=OWNER)).status_code == 404
        assert (await client.put(f"{initiative}/draft", headers=OWNER, json={
            "expected_revision": info["budget_revision"], "rows": [],
        })).status_code == 404
        assert (await client.post(f"{initiative}/publish", headers=OWNER, json={
            "expected_revision": info["budget_revision"],
        })).status_code == 404
        async with AsyncSession(engine) as session:
            assert await business_snapshot(session) == info["business"]


@pytest.mark.asyncio
@pytest.mark.parametrize("bulk", [False, True])
async def test_stopped_version_keeps_admin_project_configuration_but_allocation_stays_frozen(bulk):
    async with scenario(confirmed=True) as (client, engine, info):
        stopped = await client.patch("planning-versions/202701", headers=ADMIN, json={
            "expected_revision": info["version_revision"], "open": False,
        })
        revision = stopped.json()["data"]["revision"]
        command = {
            "name": "A", "resourceType": "MRD", "sector": "PCMO", "department": "MKT",
            "budget": 120, "ownerId": "lead@example.com", "reason": "管理员配置调整",
            "enabled": False,
        }
        if bulk:
            response = await client.post("planning-versions/202701/initiatives/import",
                                         headers=ADMIN, json={
                                             "expected_revision": revision, "preview": False,
                                             "items": [{"id": info["budget_id"], **command}],
                                         })
        else:
            response = await client.put(
                f"planning-versions/202701/initiatives/{info['budget_id']}", headers=ADMIN,
                json={"expected_revision": revision, **command},
            )
        assert response.status_code == 200
        version = response.json()["data"]["version"]
        assert version["published"] and not version["open"]
        async with AsyncSession(engine) as session:
            budget = await session.get(BudgetDO, info["budget_id"])
            assert budget.plan_budget_amount == 120 and budget.owner_email == "lead@example.com"
            assert not budget.enabled
            row = (await WorkspaceRepository(session).rows_for(budget.id))[0]
            assert row.distributor_budget_amount == 100
            workflow = await session.get(InitiativeWorkflowDO, budget.id)
            assert workflow.requires_resubmission and workflow.confirmed_publication_id is None
            history = await WorkspaceRepository(session).publications_for(budget.id)
            assert history[0].snapshot == info["business"]["WorkspacePublicationDO"][0]["snapshot"]
            budget_revision = budget.revision
        initiative = f"initiatives/{info['budget_id']}"
        read = await client.get(f"{initiative}/draft", headers=LEAD)
        assert read.status_code == 200 and not read.json()["data"]["workflow"]["editable"]
        for identity in (OWNER, LEAD):
            assert (await client.put(f"{initiative}/draft", headers=identity, json={
                "expected_revision": budget_revision, "rows": [],
            })).status_code in {404, 409}
            assert (await client.post(f"{initiative}/publish", headers=identity, json={
                "expected_revision": budget_revision,
            })).status_code in {404, 409}
