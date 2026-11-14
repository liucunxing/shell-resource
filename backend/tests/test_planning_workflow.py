"""V19 transaction/authorization regressions on a local isolated SQLite database."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.budget import BudgetDO
from app.models.do.planning import PlanningVersionDO
from app.repositories.workspace_repository import WorkspaceRepository
from app.schemas.dto.planning import (
    DepartmentActionDTO,
    PlanningVersionCreateDTO,
    PlanningVersionUpdateDTO,
)
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO, PublishDTO
from app.services.planning_service import PlanningService
from app.services.workspace_service import WorkspaceService
from test_workspace import StubDirectoryService, _session


def user(email="a@example.com", role="owner", department="MKT", sectors=("PCMO",)):
    return WorkbenchUser(
        email,
        role,
        department,
        email,
        sectors,
        affiliation_sector="PCMO",
        affiliation_department="MKT",
    )


def service(session, identity):
    return WorkspaceService(session, identity, StubDirectoryService())


async def prepare():
    session = await _session()
    admin = PlanningService(session, user("admin@example.com", "admin"))
    await admin.create(PlanningVersionCreateDTO(id="202701", name="年度规划", planning_year=2027))
    await admin.update(
        "202701", PlanningVersionUpdateDTO(expected_revision=0, published=True, open=True)
    )
    budgets = list(
        (
            await session.scalars(
                select(BudgetDO)
                .where(BudgetDO.planning_version_id == "202701")
                .order_by(BudgetDO.id)
            )
        ).all()
    )
    return session, admin, budgets


async def submit(session, budget):
    owner = service(session, user(budget.owner_email))
    saved = await owner.save_draft(
        budget.id,
        InitiativeDraftUpdateDTO(
            expected_revision=budget.revision, rows=[{"dealerId": "d1", "amount": "100"}]
        ),
    )
    return await owner.publish(budget.id, PublishDTO(expected_revision=saved["revision"]))


async def act(session, action, **kwargs):
    lead = PlanningService(session, user("lead@example.com", "lead"))
    version = await session.get(PlanningVersionDO, "202701")
    return await lead.department_action(
        "202701",
        action,
        DepartmentActionDTO(
            sector="PCMO", department="MKT", expected_revision=version.revision, **kwargs
        ),
    )


@pytest.mark.asyncio
async def test_all_submit_confirm_withdraw_reconfirm_and_targeted_return():
    session, _, budgets = await prepare()
    try:
        await submit(session, budgets[0])
        with pytest.raises(HTTPException) as partial:
            await act(session, "confirm")
        assert partial.value.status_code == 409
        await submit(session, budgets[1])
        result = await act(session, "confirm")
        assert result["confirmed"] == 2
        management = service(session, user("exec@example.com", "management"))
        visible = await management.get_workspace(2027)
        assert len(visible["state"]["initiatives"]) == 2
        assert all(i["allocationVisible"] and i["rows"] for i in visible["state"]["initiatives"])
        with pytest.raises(HTTPException) as locked:
            await service(session, user()).save_draft(
                budgets[0].id, InitiativeDraftUpdateDTO(expected_revision=1)
            )
        assert locked.value.status_code == 409
        result = await act(session, "withdraw", reason="复核")
        assert result["submitted"] == 2 and result["confirmed"] == 0 and result["canConfirm"]
        hidden = await management.get_workspace(2027)
        assert all(
            not i["allocationVisible"] and i["rows"] == [] for i in hidden["state"]["initiatives"]
        )
        assert hidden["state"]["publications"] == {}
        assert await management.publications(budgets[0].id) == []
        await act(session, "confirm")
        await act(session, "withdraw", reason="仅修改一个项目")
        result = await act(session, "return", reason="调整名单", initiative_id=budgets[0].id)
        assert result["submitted"] == 1 and not result["canConfirm"]
        assert result["items"][0]["workflow"]["requiresResubmission"]
        assert not result["items"][1]["workflow"]["requiresResubmission"]
        await submit(session, budgets[0])
        assert (await act(session, "confirm"))["confirmed"] == 2
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_source_copy_only_last_submission_and_version_isolation():
    session, admin, budgets = await prepare()
    try:
        await submit(session, budgets[0])
        await act(session, "return", reason="重新安排", initiative_id=budgets[0].id)
        await service(session, user()).save_draft(
            budgets[0].id,
            InitiativeDraftUpdateDTO(
                expected_revision=1, rows=[{"dealerId": "d1", "amount": "25"}]
            ),
        )
        await admin.create(
            PlanningVersionCreateDTO(
                id="202702", name="二月", planning_year=2027, source_version_id="202701"
            )
        )
        copy = (
            await session.scalars(
                select(BudgetDO).where(
                    BudgetDO.planning_version_id == "202702",
                    BudgetDO.owner_email == "a@example.com",
                )
            )
        ).one()
        rows = await WorkspaceRepository(session).rows_for(copy.id)
        assert rows[0].distributor_budget_amount == Decimal("100")
        assert await WorkspaceRepository(session).publications_for(copy.id) == []
        with pytest.raises(HTTPException) as unpublished:
            await service(session, user()).get_workspace(2027, version_id="202702")
        assert unpublished.value.status_code == 404
        await admin.update(
            "202702", PlanningVersionUpdateDTO(expected_revision=0, published=True, open=True)
        )
        first = await session.get(PlanningVersionDO, "202701")
        assert not first.open
        with pytest.raises(HTTPException) as closed:
            await service(session, user()).save_draft(
                budgets[0].id, InitiativeDraftUpdateDTO(expected_revision=2)
            )
        assert closed.value.status_code == 409
        workspace = await service(session, user()).get_workspace(2027)
        assert workspace["state"]["currentVersionId"] == "202702"
        assert all(i["planningVersionId"] == "202702" for i in workspace["state"]["initiatives"])
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_stale_revision_scopes_and_deadline_are_enforced():
    session, admin, budgets = await prepare()
    try:
        with pytest.raises(HTTPException) as stale:
            await admin.update("202701", PlanningVersionUpdateDTO(expected_revision=0, open=False))
        assert stale.value.status_code == 409
        foreign = PlanningService(session, user("foreign@example.com", "lead", "MKT", ("B2B",)))
        with pytest.raises(HTTPException) as scope:
            await foreign.department("202701", "PCMO", "MKT")
        assert scope.value.status_code == 403
        with pytest.raises(HTTPException) as owner_confirm:
            await PlanningService(session, user()).department_action(
                "202701",
                "confirm",
                DepartmentActionDTO(sector="PCMO", department="MKT", expected_revision=1),
            )
        assert owner_confirm.value.status_code == 403
        version = await session.get(PlanningVersionDO, "202701")
        version.deadline = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()
        with pytest.raises(HTTPException) as expired:
            await submit(session, budgets[0])
        assert expired.value.status_code == 409
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_management_cannot_bypass_confirmation_via_legacy_publications():
    session = await _session()
    try:
        await service(session, user()).save_draft(
            1,
            InitiativeDraftUpdateDTO(
                expected_revision=0, rows=[{"dealerId": "d1", "amount": "100"}]
            ),
        )
        await service(session, user()).publish(1, PublishDTO(expected_revision=1))
        admin = PlanningService(session, user("admin@example.com", "admin"))
        await admin.create(PlanningVersionCreateDTO(id="202701", name="V19", planning_year=2027))
        management = service(session, user("exec@example.com", "management"))
        assert await management.publications(1) == []
        assert await WorkspaceRepository(session).latest_publications(2027, None, None, None) == []
        with pytest.raises(HTTPException) as unavailable:
            await management.get_workspace(2027)
        assert unavailable.value.status_code == 409
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_submitted_lock_applies_to_legacy_row_mutation_api():
    from app.repositories.budget_repository import BudgetDistributorRepository, BudgetRepository
    from app.schemas.dto.workbench import DistributorAllocationCreateDTO
    from app.services.workbench_service import WorkbenchService

    session, _, budgets = await prepare()
    try:
        await submit(session, budgets[0])
        legacy = WorkbenchService(
            BudgetRepository(session), BudgetDistributorRepository(session), user()
        )
        with pytest.raises(HTTPException) as blocked:
            await legacy.create_distributor_allocation(
                budget_id=budgets[0].id,
                payload=DistributorAllocationCreateDTO(
                    distributor_code="d2", distributor_budget_amount=1
                ),
            )
        assert blocked.value.status_code == 409
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_return_scope_reason_and_stale_decisions():
    session, _, budgets = await prepare()
    try:
        for budget in budgets:
            await submit(session, budget)
        with pytest.raises(HTTPException) as blank:
            await act(session, "return", initiative_id=budgets[0].id)
        assert blank.value.status_code == 422
        with pytest.raises(HTTPException) as wrong_project:
            await act(session, "return", reason="测试", initiative_id=1)
        assert wrong_project.value.status_code == 422
        version = await session.get(PlanningVersionDO, "202701")
        stale_revision = version.revision
        result = await act(session, "return", reason="Owner核对", owner_email="A@example.com")
        assert result["submitted"] == 1
        lead = PlanningService(session, user("lead@example.com", "lead"))
        with pytest.raises(HTTPException) as stale:
            await lead.department_action(
                "202701",
                "return",
                DepartmentActionDTO(
                    sector="PCMO",
                    department="MKT",
                    expected_revision=stale_revision,
                    reason="过期窗口",
                ),
            )
        assert stale.value.status_code == 409
        result = await act(session, "return", reason="全部核对")
        assert result["submitted"] == 0
        assert all(i["workflow"]["requiresResubmission"] for i in result["items"])
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_admin_configuration_preserves_amounts_and_requires_republication():
    from app.schemas.dto.planning import VersionInitiativeDTO

    session, admin, budgets = await prepare()
    try:
        for budget in budgets:
            await submit(session, budget)
        await act(session, "confirm")
        version = await session.get(PlanningVersionDO, "202701")
        result = await admin.edit_initiative(
            "202701",
            budgets[0].id,
            VersionInitiativeDTO(
                name="调整预算",
                resourceType="MRD",
                sector="PCMO",
                department="MKT",
                budget=120,
                ownerId="a@example.com",
                expected_revision=version.revision,
                reason="预算增加",
            ),
        )
        assert result["version"]["published"] is False
        assert result["version"]["open"] is False
        assert (await WorkspaceRepository(session).rows_for(budgets[0].id))[
            0
        ].distributor_budget_amount == 100
        statuses = [await admin.workflow(b) for b in budgets]
        assert statuses[0]["requiresResubmission"]
        assert not any(s["confirmed"] for s in statuses)
        assert statuses[1]["submitted"]
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_integer_money_and_disabled_reasons_rejected_on_submission():
    from app.models.do.workspace import WorkspaceConfigDO

    session, _, budgets = await prepare()
    try:
        owner = service(session, user())
        with pytest.raises(HTTPException) as decimal:
            await owner.save_draft(
                budgets[0].id,
                InitiativeDraftUpdateDTO(
                    expected_revision=0, rows=[{"dealerId": "d1", "amount": "1.01"}]
                ),
            )
        assert decimal.value.status_code == 422
        saved = await owner.save_draft(
            budgets[0].id,
            InitiativeDraftUpdateDTO(
                expected_revision=0, otherBudgets=[{"reasonId": "misc", "amount": "100"}]
            ),
        )
        config = await session.get(WorkspaceConfigDO, 1)
        config.budget_reasons = [{"id": "misc", "label": "已停用", "enabled": False}]
        await session.commit()
        with pytest.raises(HTTPException) as disabled:
            await owner.publish(budgets[0].id, PublishDTO(expected_revision=saved["revision"]))
        assert disabled.value.status_code == 422
        config.budget_reasons = [{"id": "misc", "label": "固定原因", "enabled": True}]
        await session.commit()
        result = await owner.publish(budgets[0].id, PublishDTO(expected_revision=saved["revision"]))
        assert result["initiative"]["workflow"]["submitted"]
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_http_version_routes_validate_scope_and_preview_read_only():
    import httpx
    from fastapi import FastAPI
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.controllers.planning_controller import router as planning_router
    from app.controllers.workbench_controller import router as workbench_router
    from app.db.session import get_db_session
    from app.models.do.workspace import UserPermissionDO

    seed = await _session()
    engine = seed.bind
    seed.add_all(
        [
            UserPermissionDO(
                id=2,
                email="admin@example.com",
                display_name="Admin",
                role="admin",
                department=[],
                sector=[],
                enabled=True,
            ),
            UserPermissionDO(
                id=3,
                email="lead@example.com",
                display_name="Lead",
                role="lead",
                department=["MKT"],
                sector=["PCMO"],
                enabled=True,
            ),
        ]
    )
    await seed.commit()
    await seed.close()
    app = FastAPI()
    app.include_router(planning_router, prefix="/api/v1/workbench")
    app.include_router(workbench_router, prefix="/api/v1/workbench")

    async def database():
        async with AsyncSession(engine, expire_on_commit=False) as session:
            yield session

    app.dependency_overrides[get_db_session] = database
    admin = {"X-User-Email": "admin@example.com"}
    owner = {"X-User-Email": "a@example.com"}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test/api/v1/workbench/"
    ) as client:
        payload = {"id": "202701", "name": "V19", "planning_year": 2027}
        assert (
            await client.post("planning-versions", headers=owner, json=payload)
        ).status_code == 403
        created = await client.post("planning-versions", headers=admin, json=payload)
        assert created.status_code == 200
        assert (await client.get("planning-versions?planning_year=2027", headers=owner)).json()[
            "data"
        ] == []
        preview = {**admin, "X-Preview-User-Email": "a@example.com"}
        assert (
            await client.patch(
                "planning-versions/202701",
                headers=preview,
                json={"expected_revision": 0, "published": True, "open": True},
            )
        ).status_code == 403
        opened = await client.patch(
            "planning-versions/202701",
            headers=admin,
            json={"expected_revision": 0, "published": True, "open": True},
        )
        assert opened.status_code == 200
        response = await client.get("workspace?planning_year=2027&version_id=202701", headers=owner)
        assert response.status_code == 200
        item = response.json()["data"]["state"]["initiatives"][0]
        fractional_budget = {
            "name": "非整数预算",
            "resourceType": "MRD",
            "sector": "PCMO",
            "department": "MKT",
            "budget": "100.50",
            "ownerId": "a@example.com",
            "expected_revision": 1,
            "reason": "API校验",
            "enabled": True,
        }
        assert (
            await client.post(
                "planning-versions/202701/initiatives", headers=admin, json=fractional_budget
            )
        ).status_code == 422
        assert (
            await client.put(
                f"planning-versions/202701/initiatives/{item['id']}",
                headers=admin,
                json=fractional_budget,
            )
        ).status_code == 422
        unchanged = await client.get("planning-versions?planning_year=2027", headers=admin)
        assert unchanged.json()["data"][0]["revision"] == 1
        saved = await client.put(
            f"initiatives/{item['id']}/draft",
            headers=owner,
            json={"expected_revision": 0, "rows": [{"dealerId": "d1", "amount": 100}]},
        )
        assert saved.status_code == 200
        submitted = await client.post(
            f"initiatives/{item['id']}/publish", headers=owner, json={"expected_revision": 1}
        )
        assert submitted.status_code == 200
        assert submitted.json()["data"]["initiative"]["workflow"]["submitted"]
        assert (
            await client.put(
                f"initiatives/{item['id']}/draft",
                headers=owner,
                json={"expected_revision": 1, "rows": []},
            )
        ).status_code == 409
        stale = await client.patch(
            "planning-versions/202701", headers=admin, json={"expected_revision": 1, "open": False}
        )
        assert stale.status_code == 409
    await engine.dispose()


@pytest.mark.asyncio
async def test_new_version_requires_fresh_change_reason_and_serializes_utc():
    session, admin, budgets = await prepare()
    try:
        original = await submit(session, budgets[0])
        assert original["createdAt"].endswith("+00:00")
        await admin.create(
            PlanningVersionCreateDTO(
                id="202702", name="新版", planning_year=2027, source_version_id="202701"
            )
        )
        await admin.update(
            "202702", PlanningVersionUpdateDTO(expected_revision=0, published=True, open=True)
        )
        budget = await session.scalar(
            select(BudgetDO).where(
                BudgetDO.planning_version_id == "202702", BudgetDO.owner_email == "a@example.com"
            )
        )
        owner = service(session, user())
        with pytest.raises(HTTPException) as missing:
            await owner.publish(budget.id, PublishDTO(expected_revision=0))
        assert missing.value.status_code == 422
        saved = await owner.save_draft(
            budget.id,
            InitiativeDraftUpdateDTO(
                expected_revision=0,
                rows=[{"dealerId": "d1", "amount": 100}],
                changeReason="重新核对上版名单",
            ),
        )
        assert saved["savedAt"].endswith("+00:00")
        result = await owner.publish(budget.id, PublishDTO(expected_revision=1))
        assert result["initiative"]["changeReason"] == "重新核对上版名单"
        assert result["initiative"]["workflow"]["submittedAt"].endswith("+00:00")
    finally:
        await session.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("amount", [0, 100])
async def test_sector_change_rejected_for_any_existing_roster(amount):
    from app.models.do.workspace import UserPermissionDO
    from app.schemas.dto.planning import VersionInitiativeDTO

    session, admin, budgets = await prepare()
    try:
        session.add(
            UserPermissionDO(
                id=2,
                email="crto@example.com",
                display_name="CRTO Owner",
                role="owner",
                department=["MKT"],
                sector=["CRTO"],
                enabled=True,
            )
        )
        await session.commit()
        owner = service(session, user())
        saved = await owner.save_draft(
            budgets[0].id,
            InitiativeDraftUpdateDTO(
                expected_revision=0, rows=[{"dealerId": "d1", "amount": amount}]
            ),
        )
        if amount == 100:
            await owner.publish(budgets[0].id, PublishDTO(expected_revision=saved["revision"]))
        version = await session.get(PlanningVersionDO, "202701")
        revision = version.revision
        with pytest.raises(HTTPException) as blocked:
            await admin.edit_initiative(
                "202701",
                budgets[0].id,
                VersionInitiativeDTO(
                    name="跨业务线",
                    resourceType="MRD",
                    sector="CRTO",
                    department="MKT",
                    budget=100,
                    ownerId="crto@example.com",
                    expected_revision=revision,
                    reason="改派业务线",
                ),
            )
        assert blocked.value.status_code == 422
        assert "清空名单" in blocked.value.detail
        assert budgets[0].sector == "PCMO" and budgets[0].owner_email == "a@example.com"
        assert version.revision == revision and version.published
        rows = await WorkspaceRepository(session).rows_for(budgets[0].id)
        assert rows[0].distributor_budget_amount == amount
        if amount == 100:
            history = await WorkspaceRepository(session).publications_for(budgets[0].id)
            assert history[-1].snapshot["initiative"]["sector"] == "PCMO"
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_dirty_cross_sector_roster_is_blocked_on_save_and_publish():
    session, _, budgets = await prepare()
    try:
        await submit(session, budgets[0])
        await act(session, "return", reason="核对", initiative_id=budgets[0].id)
        # Simulate data persisted by an older application before the configuration guard.
        budgets[0].sector = "CRTO"
        budgets[0].owner_email = "crto@example.com"
        await session.commit()
        owner = service(session, user("crto@example.com", sectors=("CRTO",)))
        with pytest.raises(HTTPException) as save:
            await owner.save_draft(
                budgets[0].id,
                InitiativeDraftUpdateDTO(
                    expected_revision=1, rows=[{"dealerId": "d1", "amount": 100}]
                ),
            )
        assert save.value.status_code == 422
        with pytest.raises(HTTPException) as publish:
            await owner.publish(budgets[0].id, PublishDTO(expected_revision=1))
        assert publish.value.status_code == 422
        assert len(await WorkspaceRepository(session).publications_for(budgets[0].id)) == 1
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_existing_closed_dealer_in_same_sector_can_save_and_submit():
    from app.models.do.distributor_history import distributor_sellin_resource_history

    session, _, budgets = await prepare()
    try:
        owner = WorkspaceService(session, user())
        saved = await owner.save_draft(
            budgets[0].id,
            InitiativeDraftUpdateDTO(expected_revision=0, rows=[{"dealerId": "d1", "amount": 100}]),
        )
        await session.execute(
            distributor_sellin_resource_history.update()
            .where(distributor_sellin_resource_history.c.distributor_code == "d1")
            .values(distributor_status="0")
        )
        await session.commit()
        saved = await owner.save_draft(
            budgets[0].id,
            InitiativeDraftUpdateDTO(
                expected_revision=saved["revision"], rows=[{"dealerId": "d1", "amount": 100}]
            ),
        )
        result = await owner.publish(budgets[0].id, PublishDTO(expected_revision=saved["revision"]))
        assert result["initiative"]["workflow"]["submitted"]
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_inherited_fractional_budget_requires_explicit_correction_before_publish():
    from app.schemas.dto.planning import VersionInitiativeDTO

    session = await _session()
    try:
        legacy = await session.get(BudgetDO, 1)
        legacy.plan_budget_amount = Decimal("100.50")
        await session.commit()
        admin = PlanningService(session, user("admin@example.com", "admin"))
        await admin.create(
            PlanningVersionCreateDTO(id="202701", name="首版核对", planning_year=2027)
        )
        copy = await session.scalar(
            select(BudgetDO).where(
                BudgetDO.planning_version_id == "202701", BudgetDO.initiative_key == "1"
            )
        )
        assert copy.plan_budget_amount == Decimal("100.50")
        with pytest.raises(HTTPException) as fractional:
            await admin.update(
                "202701", PlanningVersionUpdateDTO(expected_revision=0, published=True, open=True)
            )
        assert fractional.value.status_code == 422
        version = await session.get(PlanningVersionDO, "202701")
        assert not version.published and not version.open and version.revision == 0
        assert legacy.plan_budget_amount == copy.plan_budget_amount == Decimal("100.50")
        await admin.edit_initiative(
            "202701",
            copy.id,
            VersionInitiativeDTO(
                name="A",
                resourceType="MRD",
                sector="PCMO",
                department="MKT",
                budget=100,
                ownerId="a@example.com",
                expected_revision=0,
                reason="明确调整为整数元",
            ),
        )
        opened = await admin.update(
            "202701", PlanningVersionUpdateDTO(expected_revision=1, published=True, open=True)
        )
        assert opened["open"] and opened["published"]
        assert legacy.plan_budget_amount == Decimal("100.50")
    finally:
        await session.close()
