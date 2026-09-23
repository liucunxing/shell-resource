"""HTTP contract tests with the real email dependency and SQLite transactions."""

from decimal import Decimal
from io import BytesIO
from zipfile import ZipFile

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.controllers.workbench_controller import router
from app.db.session import get_db_session
from app.models.do.budget import BudgetDO
from app.models.do.workspace import BudgetChangeLogDO, UserPermissionDO, WorkspaceConfigDO
from test_workspace import _session


@pytest_asyncio.fixture
async def api():
    seed = await _session()
    engine = seed.bind
    for index, (email, role, dept, sector) in enumerate(
        [
            ("b@example.com", "owner", "MKT", "S"),
            ("lead@example.com", "lead", "MKT", "S"),
            ("management@example.com", "management", None, None),
            ("admin@example.com", "admin", None, None),
            ("bad@example.com", "unknown", None, None),
            ("missing@example.com", "owner", None, None),
        ],
        2,
    ):
        seed.add(
            UserPermissionDO(
                id=index,
                email=email,
                role=role,
                display_name=role,
                department=dept,
                sector=sector,
                enabled=True,
            )
        )
    await seed.commit()
    await seed.close()
    app = FastAPI()
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


def headers(email="a@example.com"):
    return {"X-User-Email": email}


@pytest.mark.asyncio
async def test_http_auth_and_role_boundaries(api):
    client, _ = api
    assert (await client.get("workspace?planning_year=2027")).status_code == 401
    for email in ("bad@example.com", "missing@example.com", "absent@example.com"):
        assert (
            await client.get("workspace?planning_year=2027", headers=headers(email))
        ).status_code == 403
    assert (await client.get("initiatives/2/draft", headers=headers())).status_code == 404
    assert (
        await client.get("initiatives/1/draft", headers=headers("lead@example.com"))
    ).status_code == 200
    for email in ("management@example.com", "admin@example.com"):
        assert (await client.get("initiatives/1/draft", headers=headers(email))).status_code == 403
        assert (await client.get("my-initiatives", headers=headers(email))).status_code == 403
    for email in ("lead@example.com", "management@example.com", "admin@example.com"):
        response = await client.put(
            "initiatives/1/draft", headers=headers(email), json={"expected_revision": 0}
        )
        assert response.status_code == 403
        response = await client.post(
            "initiatives/1/distributor-allocations",
            headers=headers(email),
            json={"distributor_code": "d1", "distributor_budget_amount": 20},
        )
        assert response.status_code == 403


@pytest.mark.asyncio
async def test_empty_draft_can_choose_dealer_without_unscoped_history(api):
    client, _ = api
    response = await client.get("workspace?planning_year=2027", headers=headers())
    assert response.status_code == 200
    dealers = response.json()["data"]["data"]["dealers"]
    assert any(item["id"] == "d1" for item in dealers)
    assert all(item["history"] == {} for item in dealers)


@pytest.mark.asyncio
async def test_actual_auth_transaction_legacy_crud_and_other_totals(api):
    client, engine = api
    draft = {
        "expected_revision": 0,
        "otherBudgets": [{"id": "OB-temp", "reasonId": "misc", "amount": "10.00", "note": "test"}],
    }
    response = await client.put("initiatives/1/draft", headers=headers(), json=draft)
    assert response.status_code == 200, response.text
    response = await client.post(
        "initiatives/1/distributor-allocations",
        headers=headers(),
        json={"distributor_code": "d1", "distributor_budget_amount": 40},
    )
    assert response.status_code == 200, response.text
    allocation = response.json()["data"]["id"]
    duplicate = await client.post(
        "initiatives/1/distributor-allocations",
        headers=headers(),
        json={"distributor_code": "d1", "distributor_budget_amount": 20},
    )
    assert duplicate.status_code == 409
    null_amount = await client.patch(
        f"initiatives/1/distributor-allocations/{allocation}",
        headers=headers(),
        json={"distributor_budget_amount": None},
    )
    assert null_amount.status_code == 422
    response = await client.patch(
        f"initiatives/1/distributor-allocations/{allocation}",
        headers=headers(),
        json={"distributor_budget_amount": 50},
    )
    assert response.status_code == 200, response.text
    summary = (await client.get("initiatives/1/budget-summary", headers=headers())).json()["data"]
    assert Decimal(str(summary["allocated_amount"])) == 60
    assert Decimal(str(summary["unexplained_difference"])) == 40
    assert (
        await client.delete(
            f"initiatives/1/distributor-allocations/{allocation}", headers=headers()
        )
    ).status_code == 200
    async with AsyncSession(engine) as session:
        budget = await session.get(BudgetDO, 1)
        assert budget.revision == 4 and budget.status == 0
        assert budget.allocate_budget_amount == 10
        assert len((await session.scalars(select(BudgetChangeLogDO))).all()) == 4


@pytest.mark.asyncio
async def test_publications_stay_immutable_and_frontend_shape(api):
    client, _ = api
    payload = {"expected_revision": 0, "rows": [{"dealerId": "d1", "amount": 90}]}
    assert (
        await client.put("initiatives/1/draft", headers=headers(), json=payload)
    ).status_code == 200
    assert (
        await client.post("initiatives/1/publish", headers=headers(), json={"expected_revision": 1})
    ).status_code == 422
    payload.update(
        expected_revision=1,
        otherBudgets=[{"id": "OB-new", "reasonId": "misc", "amount": 10, "note": "reason"}],
    )
    assert (
        await client.put("initiatives/1/draft", headers=headers(), json=payload)
    ).status_code == 200
    response = await client.post(
        "initiatives/1/publish", headers=headers(), json={"expected_revision": 2}
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["guideVersion"] == 3
    assert "reference" in response.json()["data"]
    state = (await client.get("workspace?planning_year=2027", headers=headers())).json()["data"][
        "state"
    ]
    assert set(state["departments"]) == {"MKT", "ICE", "CAPEX"}
    assert state["initiatives"][0]["publishedRevision"] == 2
    assert (
        await client.put("initiatives/1/draft", headers=headers(), json={"expected_revision": 2})
    ).status_code == 200
    manager = (
        await client.get("workspace?planning_year=2027", headers=headers("management@example.com"))
    ).json()["data"]["state"]
    assert manager["initiatives"][0]["rows"][0]["amount"] == 90
    assert manager["initiatives"][0]["status"] == "completed"
    for email in ("a@example.com", "lead@example.com", "management@example.com"):
        assert (
            await client.get("initiatives/1/publications", headers=headers(email))
        ).status_code == 200
    assert (
        await client.get("initiatives/1/publications", headers=headers("admin@example.com"))
    ).status_code == 403
    payload.update(expected_revision=3)
    await client.put("initiatives/1/draft", headers=headers(), json=payload)
    await client.post("initiatives/1/publish", headers=headers(), json={"expected_revision": 4})
    history = (await client.get("initiatives/1/publications", headers=headers())).json()["data"]
    assert [item["number"] for item in history] == [1, 2]
    assert history[-1]["publishedRevision"] == 4


@pytest.mark.asyncio
async def test_validation_is_atomic_disabled_reason_retention(api):
    client, engine = api
    for payload in (
        {"rows": [{"dealerId": "unknown", "amount": 1}]},
        {"otherBudgets": [{"reasonId": "unknown", "amount": 1}]},
        {"rows": [{"dealerId": "d1", "amount": 1}, {"dealerId": "d1", "amount": 2}]},
    ):
        response = await client.put(
            "initiatives/1/draft", headers=headers(), json={"expected_revision": 0, **payload}
        )
        assert response.status_code == 422
    payload = {
        "expected_revision": 0,
        "otherBudgets": [{"reasonId": "misc", "amount": 4, "note": "old"}],
    }
    response = await client.put("initiatives/1/draft", headers=headers(), json=payload)
    row = response.json()["data"]["otherBudgets"][0]
    async with AsyncSession(engine) as session:
        config = await session.get(WorkspaceConfigDO, 1)
        config.budget_reasons = [{"id": "misc", "enabled": False}]
        await session.commit()
    assert (
        await client.put(
            "initiatives/1/draft",
            headers=headers(),
            json={"expected_revision": 1, "otherBudgets": [row]},
        )
    ).status_code == 200
    row["amount"] = 5
    assert (
        await client.put(
            "initiatives/1/draft",
            headers=headers(),
            json={"expected_revision": 2, "otherBudgets": [row]},
        )
    ).status_code == 422
    assert (
        await client.put("initiatives/1/draft", headers=headers(), json={"expected_revision": 0})
    ).status_code == 409
    current = (await client.get("initiatives/1/draft", headers=headers())).json()["data"]
    assert current["revision"] == 2 and current["otherBudgets"][0]["amount"] == 4


@pytest.mark.asyncio
async def test_scope_year_and_unfiltered_summary(api):
    client, engine = api
    async with AsyncSession(engine) as session:
        first = await session.get(BudgetDO, 1)
        first.planning_year = 2028
        await session.commit()
    assert (await client.get("initiatives/1/draft", headers=headers())).status_code == 200
    assert (await client.get("initiatives/1/budget-summary", headers=headers())).status_code == 200
    async with AsyncSession(engine) as session:
        first = await session.get(BudgetDO, 1)
        first.planning_year = 2027
        first.sector = "another"
        await session.commit()
    assert (await client.get("initiatives/1/draft", headers=headers())).status_code == 404
    state = (await client.get("workspace?planning_year=2027", headers=headers())).json()["data"][
        "state"
    ]
    assert state["initiatives"] == []
    result = (
        await client.get(
            "my-initiatives?initiative_keyword=absent", headers=headers("b@example.com")
        )
    ).json()["data"]
    assert result["initiatives"] == []
    assert result["responsible_budget"]["initiative_count"] == 1


@pytest.mark.asyncio
async def test_append_import_duplicate_batch_rolls_back(api):
    client, engine = api
    await client.post(
        "initiatives/1/distributor-allocations",
        headers=headers(),
        json={"distributor_code": "d1", "distributor_budget_amount": 10},
    )
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
            '<row><c r="A1" t="inlineStr"><is><t>distributor_code</t></is></c>'
            '<c r="B1" t="inlineStr"><is><t>distributor_budget_amount</t></is></c>'
            '<c r="C1" t="inlineStr"><is><t>description</t></is></c></row>'
            '<row><c r="A2" t="inlineStr"><is><t>d2</t></is></c><c r="B2"><v>20</v></c></row>'
            '<row><c r="A3" t="inlineStr"><is><t>d1</t></is></c><c r="B3"><v>30</v></c></row>'
            "</sheetData></worksheet>",
        )
    response = await client.post(
        "initiatives/1/distributor-allocations/import",
        headers=headers(),
        files={"file": ("batch.xlsx", output.getvalue())},
    )
    assert response.status_code == 409, response.text
    rows = (await client.get("initiatives/1/distributor-allocations", headers=headers())).json()[
        "data"
    ]
    assert len(rows) == 1 and rows[0]["distributor_code"] == "d1"
