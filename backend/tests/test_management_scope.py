"""Sector grants constrain serialized budgets, snapshots and historical identities."""

from dataclasses import replace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.controllers.planning_controller import router as planning_router
from app.controllers.workbench_controller import router
from app.core.exception_handlers import register_exception_handlers
from app.core.resource_access import SECTORS
from app.db.session import get_db_session
from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.budget import BudgetDO
from app.models.do.distributor_history import distributor_sellin_resource_history
from app.models.do.planning import InitiativeWorkflowDO, PlanningVersionDO
from app.models.do.workspace import UserPermissionDO, WorkspacePublicationDO
from app.schemas.dto.workbench import AdminUserDTO
from app.services.workspace_service import WorkspaceService
from test_workspace import _session


@pytest_asyncio.fixture
async def scoped_api():
    db = await _session()
    manager = UserPermissionDO(
        email="manager@example.test", display_name="Manager", role="management",
        department=[], sector=["PCMO"], affiliation_sector="B2B",
        affiliation_department="MKT", enabled=True,
    )
    db.add_all([manager, UserPermissionDO(
        email="admin@example.test", display_name="Admin", role="admin", enabled=True,
    )])
    for version in ("scope-old", "scope-new"):
        db.add(PlanningVersionDO(
            id=version, name=version, planning_year=2027, published=True,
            open=version == "scope-new", created_by="admin@example.test",
        ))
        for n, sector in enumerate(SECTORS, 1):
            # An unconfirmed ICE project verifies the original management visibility rule.
            for department in ("MKT", "ICE"):
                budget = BudgetDO(
                    planning_year=2027, planning_version_id=version, sector=sector,
                    department=department, resource_type="MRD",
                    initiative_name=f"{sector}-{department}",
                    plan_budget_amount=n * 100, allocate_budget_amount=0,
                    owner_email="a@example.com", revision=0, status=0, input_source="TEST",
                )
                db.add(budget)
                await db.flush()
                publication = WorkspacePublicationDO(
                    budget_id=budget.id, department=department, publication_number=1,
                    published_revision=0, snapshot={"initiative": {
                        "id": str(budget.id), "sector": sector, "department": department,
                        "name": budget.initiative_name, "budget": n * 100, "rows": [],
                        "otherBudgets": [{"reasonId": "misc", "amount": n * 100}],
                    }},
                )
                db.add(publication)
                await db.flush()
                db.add(InitiativeWorkflowDO(
                    budget_id=budget.id, publication_id=publication.id,
                    confirmed_publication_id=publication.id if department == "MKT" else None,
                ))
    await db.execute(distributor_sellin_resource_history.insert(), [
        {"sector": sector, "distributor_code": "same-code", "distributor_name": sector,
         "distributor_status": "1", "volume_2025": n * 1000, "c3_2025": n * 10}
        for n, sector in enumerate(SECTORS, 1)
    ])
    await db.commit()
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(router)
    app.include_router(planning_router)

    async def database():
        yield db

    app.dependency_overrides[get_db_session] = database
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test",
        ) as client:
            yield client, db, manager
    finally:
        await db.close()
        await db.bind.dispose()


def headers(preview=False):
    return ({"X-User-Email": "admin@example.test",
             "X-Preview-User-Email": "manager@example.test"} if preview
            else {"X-User-Email": "manager@example.test"})


@pytest.mark.asyncio
@pytest.mark.parametrize("grants", [["PCMO"], ["PCMO", "OEM"], list(SECTORS)])
@pytest.mark.parametrize("preview", [False, True])
async def test_all_reads_respect_multi_sector_grants(scoped_api, grants, preview):
    client, db, manager = scoped_api
    manager.sector = grants
    await db.commit()
    identity = await client.get("/identity", headers=headers(preview))
    assert identity.status_code == 200
    assert identity.headers["cache-control"] == "no-store"
    assert identity.json()["data"]["sectors"] == grants
    for version in ("scope-old", "scope-new"):
        response = await client.get(
            f"/workspace?planning_year=2027&version_id={version}&sector=B2B",
            headers=headers(preview),
        )
        assert response.status_code == 200, response.text
        payload = response.json()["data"]
        items = payload["state"]["initiatives"]
        assert {i["sector"] for i in items} == set(grants)
        assert len(items) == len(grants) * 2
        assert sum(i["budget"] for i in items) == sum(
            (SECTORS.index(s) + 1) * 200 for s in grants
        )
        assert all(i["allocationVisible"] == (i["department"] == "MKT") for i in items)
        assert all(not i["otherBudgets"] for i in items if i["department"] == "ICE")
        assert {d["sector"] for d in payload["data"]["dealers"]} == set(grants)
        same = [d for d in payload["data"]["dealers"] if d["code"] == "same-code"]
        assert len(same) == len(grants)
        assert len({(d["sector"], d["id"]) for d in same}) == len(grants)
        assert sum(d["history"]["vol2025"] for d in same) == sum(
            (SECTORS.index(s) + 1) * 1000 for s in grants
        )
        comparison = await client.get(
            f"/version-comparison/summary?planning_year=2027&version_id={version}",
            headers=headers(preview),
        )
        assert {i["sector"] for i in comparison.json()["data"]["initiatives"]} == set(grants)
    directory = await client.get("/distributors", headers=headers(preview))
    assert {d["sector"] for d in directory.json()["data"]} == set(grants)
    # A direct ID cannot grant access even if the user knows it.
    budgets = (await db.scalars(select(BudgetDO).where(
        BudgetDO.planning_version_id == "scope-old",
    ))).all()
    for budget in budgets:
        result = await client.get(
            f"/initiatives/{budget.id}/publications", headers=headers(preview),
        )
        assert result.status_code == (200 if budget.sector in grants else 404)
    denied = await client.get("/initiatives/1/draft", headers=headers(preview))
    assert denied.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("grants", [None, [], ["OTHER"], ["PCMO", "PCMO"]])
async def test_invalid_or_missing_grants_fail_closed(scoped_api, grants):
    client, db, manager = scoped_api
    manager.sector = grants
    await db.commit()
    for path in ("/identity", "/workspace?planning_year=2027", "/distributors",
                 "/initiatives/1/publications", "/planning-versions?planning_year=2027"):
        for preview in (False, True):
            response = await client.get(path, headers=headers(preview))
            assert response.status_code == 403
            assert response.json()["data"] is None


@pytest.mark.asyncio
async def test_legacy_snapshots_and_scope_change_without_version_revision(scoped_api):
    client, db, manager = scoped_api
    for budget_id, sector in ((1, "PCMO"), (2, "OEM")):
        budget = await db.get(BudgetDO, budget_id)
        budget.sector = sector
        budget.planning_year = 2028
        db.add(WorkspacePublicationDO(
            budget_id=budget_id, department="MKT", publication_number=1, published_revision=0,
            snapshot={"initiative": {"id": str(budget_id), "sector": sector, "department": "MKT",
                                     "rows": [], "otherBudgets": []}},
        ))
    manager.sector = ["PCMO", "OEM"]
    await db.commit()
    identity = WorkbenchUser(manager.email, "management", [], "Manager", tuple(manager.sector))
    legacy = await WorkspaceService(db, identity).get_workspace(2028)
    assert {i["sector"] for i in legacy["state"]["initiatives"]} == {"PCMO", "OEM"}
    assert await WorkspaceService(db, identity).publications(2)
    manager.sector = ["PCMO"]
    await db.commit()
    response = await client.get("/identity", headers=headers())
    assert response.json()["data"]["sectors"] == ["PCMO"]
    assert (await client.get("/initiatives/2/publications", headers=headers())).status_code == 404
    # A historical snapshot pointing at a different sector must also be excluded.
    scoped = WorkspaceService(db, replace(identity, sectors=("PCMO",)))
    budget = await db.get(BudgetDO, 2)
    budget.sector = "PCMO"
    await db.commit()
    assert await scoped.publications(2) == []


def test_management_dto_requires_explicit_grants():
    body = dict(email="manager@example.test", display_name="Manager", role="management",
                affiliation_sector="B2B", affiliation_department="MKT")
    for sectors in ([], ["OTHER"], ["PCMO", "PCMO"]):
        with pytest.raises(ValidationError):
            AdminUserDTO(**body, sector=sectors)
    assert AdminUserDTO(**body, sector=["PCMO", "OEM"]).department == []
    with pytest.raises(HTTPException) as failure:
        WorkbenchUser("manager@example.test", "management", [], "Manager").require_data_scope()
    assert failure.value.status_code == 403
