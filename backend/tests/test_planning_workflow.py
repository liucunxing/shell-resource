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
    PlanningVersionDeleteDTO,
    PlanningVersionReleaseDTO,
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
    owner = service(session, user(budget.owner_email, department=budget.department))
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
async def test_lead_owns_draft_without_exposing_other_drafts_or_changing_department_snapshot():
    session, _, budgets = await prepare()
    try:
        own, other = budgets
        own.owner_email = "lead@example.com"
        await session.commit()
        lead = service(session, user("lead@example.com", "lead"))
        saved = await lead.save_draft(own.id, InitiativeDraftUpdateDTO(
            expected_revision=own.revision, rows=[{"dealerId": "d1", "amount": "100"}]
        ))
        workspace = await lead.get_workspace(2027, version_id="202701")
        snapshots = {item["id"]: item for item in workspace["state"]["initiatives"]}
        drafts = workspace["state"]["ownInitiatives"]
        assert [item["id"] for item in drafts] == [str(own.id)]
        assert drafts[0]["rows"] and drafts[0]["workflow"]["editable"]
        assert not snapshots[str(own.id)]["rows"] and not snapshots[str(other.id)]["rows"]
        with pytest.raises(HTTPException) as denied:
            await lead.save_draft(
                other.id, InitiativeDraftUpdateDTO(expected_revision=other.revision)
            )
        assert denied.value.status_code == 403
        await lead.publish(own.id, PublishDTO(expected_revision=saved["revision"]))
        await submit(session, other)
        await act(session, "confirm")
        locked = await lead.get_workspace(2027, version_id="202701")
        assert not locked["state"]["ownInitiatives"][0]["workflow"]["editable"]
        with pytest.raises(HTTPException) as failure:
            await lead.save_draft(
                own.id, InitiativeDraftUpdateDTO(expected_revision=saved["revision"])
            )
        assert failure.value.status_code == 409
        await act(session, "withdraw", reason="需要调整")
        unlocked = await lead.get_workspace(2027, version_id="202701")
        assert unlocked["state"]["ownInitiatives"][0]["workflow"]["editable"]
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_reuse_deleted_version_code_preserves_archived_version_and_budgets():
    session, admin, _ = await prepare()
    try:
        payload = PlanningVersionCreateDTO(
            id="202702", name="旧版", planning_year=2027, source_version_id="202701",
        )
        await admin.create(payload)
        original = list((await session.scalars(
            select(BudgetDO).where(BudgetDO.planning_version_id == "202702")
        )).all())
        original_ids = {item.id for item in original}
        await admin.delete(
            "202702", PlanningVersionDeleteDTO(expected_revision=0, confirm_submitted=False),
        )
        await admin.create(PlanningVersionCreateDTO(
            id="202702", name="新版", planning_year=2027, source_version_id="202701",
        ))
        current = await admin.version("202702")
        assert current.name == "新版" and current.deleted_at is None
        archived = (await session.scalars(
            select(PlanningVersionDO).where(PlanningVersionDO.deleted_at.is_not(None))
        )).one()
        assert archived.id.startswith("deleted-")
        preserved = list((await session.scalars(
            select(BudgetDO).where(BudgetDO.planning_version_id == archived.id)
        )).all())
        assert {item.id for item in preserved} == original_ids
        new_ids = set((await session.scalars(
            select(BudgetDO.id).where(BudgetDO.planning_version_id == "202702")
        )).all())
        assert new_ids and new_ids.isdisjoint(original_ids)
        with pytest.raises(HTTPException) as duplicate:
            await admin.create(PlanningVersionCreateDTO(
                id="202702", name="重复", planning_year=2027, source_version_id="202701",
            ))
        assert duplicate.value.status_code == 409
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_all_submit_confirm_withdraw_unlocks_all_and_reconfirm():
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
        for budget in budgets:
            draft = await service(session, user(budget.owner_email)).get_draft(budget.id)
            assert draft["workflow"]["submitted"] and draft["workflow"]["editable"]
        await service(session, user()).save_draft(
            budgets[0].id, InitiativeDraftUpdateDTO(
                expected_revision=budgets[0].revision, rows=[{"dealerId": "d1", "amount": 100}]
            ),
        )
        result = await PlanningService(session, user("lead@example.com", "lead")).department(
            "202701", "PCMO", "MKT"
        )
        assert result["submitted"] == 1 and not result["canConfirm"]
        assert result["items"][1]["workflow"]["submitted"]
        await submit(session, budgets[0])
        assert (await act(session, "confirm"))["confirmed"] == 2
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_source_copy_only_last_submission_and_version_isolation():
    session, admin, budgets = await prepare()
    try:
        await submit(session, budgets[0])
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
        for original_budget in budgets:
            await submit(session, original_budget)
        await act(session, "confirm")
        await admin.update(
            "202702", PlanningVersionUpdateDTO(expected_revision=0, published=True, open=True)
        )
        first = await session.get(PlanningVersionDO, "202701")
        assert not first.open
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
        await submit(session, budgets[0])
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
async def test_withdraw_reason_and_stale_decisions():
    session, _, budgets = await prepare()
    try:
        for budget in budgets:
            await submit(session, budget)
        await act(session, "confirm")
        with pytest.raises(HTTPException) as blank:
            await act(session, "withdraw")
        assert blank.value.status_code == 422
        version = await session.get(PlanningVersionDO, "202701")
        stale_revision = version.revision
        result = await act(session, "withdraw", reason="部门复核")
        assert result["submitted"] == 2 and result["confirmed"] == 0
        assert not any(i["workflow"]["ownerEditLocked"] for i in result["items"])
        lead = PlanningService(session, user("lead@example.com", "lead"))
        with pytest.raises(HTTPException) as stale:
            await lead.department_action("202701", "confirm", DepartmentActionDTO(
                sector="PCMO", department="MKT", expected_revision=stale_revision,
            ))
        assert stale.value.status_code == 409
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_admin_configuration_preserves_open_version_and_requires_project_resubmission():
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
        assert result["version"]["published"] is True
        assert result["version"]["open"] is True
        assert (await WorkspaceRepository(session).rows_for(budgets[0].id))[
            0
        ].distributor_budget_amount == 100
        statuses = [await admin.workflow(b) for b in budgets]
        assert statuses[0]["requiresResubmission"]
        assert not any(s["confirmed"] for s in statuses)
        assert statuses[1]["submitted"]
        owner_draft = await service(session, user()).get_draft(budgets[0].id)
        assert owner_draft["editable"]
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
        assert created.json()["data"]["createdBy"] == "admin@example.com"
        listed = await client.get("planning-versions?planning_year=2027", headers=admin)
        assert listed.json()["data"][0]["createdBy"] == "admin@example.com"
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
        ).status_code == 200
        stale = await client.patch(
            "planning-versions/202701", headers=admin, json={"expected_revision": 1, "open": False}
        )
        assert stale.status_code == 409
        current = (await client.get("planning-versions?planning_year=2027", headers=admin)).json()[
            "data"
        ][0]
        release = {
            "expected_revision": current["revision"], "reason": "全量复核",
        }
        for headers in (owner, preview, {"X-User-Email": "lead@example.com"}):
            denied = await client.post("planning-versions/202701/release", headers=headers,
                                       json=release)
            assert denied.status_code == 403
        for invalid in ({"deadline": None}, {"reason": " "}):
            rejected = await client.post("planning-versions/202701/release", headers=admin,
                                         json={**release, **invalid})
            assert rejected.status_code == 422
        released = await client.post("planning-versions/202701/release", headers=admin,
                                     json=release)
        assert released.status_code == 200
        assert released.json()["data"]["releasedInitiatives"] == 2
        removed = await client.post("planning-versions/202701/department/return",
                                    headers={"X-User-Email": "lead@example.com"}, json={
                                        "sector": "PCMO", "department": "MKT",
                                        "expected_revision": current["revision"] + 1,
                                        "reason": "removed",
                                    })
        assert removed.status_code == 422
    await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("note", ["", "   "])
async def test_new_version_submits_without_reason_preserves_optional_note_and_serializes_utc(note):
    session, admin, budgets = await prepare()
    try:
        original = await submit(session, budgets[0])
        assert original["createdAt"].endswith("+00:00")
        await admin.create(
            PlanningVersionCreateDTO(
                id="202702", name="新版", planning_year=2027, source_version_id="202701"
            )
        )
        for original_budget in budgets:
            await submit(session, original_budget)
        await act(session, "confirm")
        await admin.update(
            "202702", PlanningVersionUpdateDTO(expected_revision=0, published=True, open=True)
        )
        budget = await session.scalar(
            select(BudgetDO).where(
                BudgetDO.planning_version_id == "202702", BudgetDO.owner_email == "a@example.com"
            )
        )
        owner = service(session, user())
        inherited = await owner.publish(budget.id, PublishDTO(expected_revision=0, note=note))
        assert inherited["initiative"]["changeReason"] == ""
        assert inherited["initiative"]["workflow"]["submitted"]
        assert inherited["initiative"]["workflow"]["editable"]
        assert inherited["note"] is None
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
        saved = await owner.save_draft(
            budget.id,
            InitiativeDraftUpdateDTO(
                expected_revision=1,
                rows=[{"dealerId": "d1", "amount": 60}, {"dealerId": "d2", "amount": 40}],
                changeReason=note,
            ),
        )
        assert not saved["workflow"]["submitted"] and saved["workflow"]["editable"]
        resubmitted = await owner.publish(
            budget.id, PublishDTO(expected_revision=saved["revision"], note=note)
        )
        assert resubmitted["initiative"]["changeReason"] == ""
        assert resubmitted["initiative"]["workflow"]["submitted"]
        assert resubmitted["note"] is None
        history = await owner.publications(budget.id)
        assert len(history) == 3
        assert {item["id"]: item["initiative"]["changeReason"] for item in history} == {
            inherited["id"]: "", result["id"]: "重新核对上版名单", resubmitted["id"]: "",
        }
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
async def test_closed_amount_returns_to_unallocated_and_cannot_be_submitted():
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
        draft = await owner.get_draft(budgets[0].id)
        assert draft["rows"] == []
        assert draft["budget"] == 100
        with pytest.raises(HTTPException, match="active"):
            await owner.publish(budgets[0].id, PublishDTO(expected_revision=saved["revision"]))
        with pytest.raises(HTTPException, match="active"):
            await owner.save_draft(budgets[0].id, InitiativeDraftUpdateDTO(
                expected_revision=saved["revision"], rows=[{"dealerId": "d1", "amount": 100}]))
        saved = await owner.save_draft(budgets[0].id, InitiativeDraftUpdateDTO(
            expected_revision=saved["revision"], rows=[]))
        assert saved["rows"] == []
        assert await WorkspaceRepository(session).rows_for(budgets[0].id) == []
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


@pytest.mark.asyncio
async def test_owner_can_revise_until_confirmation_and_admin_release_unlocks_all():
    session, admin, budgets = await prepare()
    try:
        owner = service(session, user())
        await submit(session, budgets[0])
        assert (await owner.get_draft(budgets[0].id))["workflow"]["editable"]
        draft = await owner.save_draft(budgets[0].id, InitiativeDraftUpdateDTO(
            expected_revision=1, rows=[{"dealerId": "d1", "amount": 100}]
        ))
        assert not draft["workflow"]["submitted"]
        await submit(session, budgets[1])
        with pytest.raises(HTTPException):
            await act(session, "confirm")
        await owner.publish(budgets[0].id, PublishDTO(expected_revision=2))
        await act(session, "confirm")
        version = await session.get(PlanningVersionDO, "202701")
        await admin.release("202701", PlanningVersionReleaseDTO(
            expected_revision=version.revision, reason="管理层复核",
        ))
        for budget in budgets:
            workflow = (await service(session, user(budget.owner_email)).get_draft(
                budget.id))["workflow"]
            assert workflow["submitted"] and workflow["editable"]
            assert not workflow["confirmed"] and not workflow["ownerEditLocked"]
        await submit(session, budgets[0])
        assert (await owner.get_draft(budgets[0].id))["workflow"]["editable"]
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_version_edit_and_deletion_preserve_history():
    session, admin, budgets = await prepare()
    try:
        await submit(session, budgets[0])
        version = await session.get(PlanningVersionDO, "202701")
        with pytest.raises(HTTPException) as opened:
            await admin.delete(
                "202701", PlanningVersionDeleteDTO(expected_revision=version.revision)
            )
        assert opened.value.status_code == 409
        changed = await admin.update("202701", PlanningVersionUpdateDTO(
            expected_revision=version.revision, id="202703", name="更正名称"
        ))
        assert changed["id"] == "202703" and changed["name"] == "更正名称"
        assert all(b.planning_version_id == "202703" for b in budgets)
        info = await admin.deletion_info("202703")
        assert info["submittedCount"] == 1 and not info["canDelete"]
        changed = await admin.update("202703", PlanningVersionUpdateDTO(
            expected_revision=info["revision"], open=False
        ))
        with pytest.raises(HTTPException) as missing_ack:
            await admin.delete("202703", PlanningVersionDeleteDTO(
                expected_revision=changed["revision"]
            ))
        assert missing_ack.value.status_code == 409
        await admin.delete("202703", PlanningVersionDeleteDTO(
            expected_revision=changed["revision"], confirm_submitted=True
        ))
        assert await admin.versions(2027) == []
        assert len(await WorkspaceRepository(session).publications_for(budgets[0].id)) == 1
        with pytest.raises(HTTPException) as deleted:
            await admin.version("202703")
        assert deleted.value.status_code == 404
        assert await admin.resolve(2027) is None
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_renaming_source_updates_derived_versions_and_detects_stale_revision():
    session, admin, _ = await prepare()
    try:
        await admin.create(PlanningVersionCreateDTO(
            id="202702", name="后续版本", planning_year=2027, source_version_id="202701"
        ))
        source = await session.get(PlanningVersionDO, "202701")
        await admin.update("202701", PlanningVersionUpdateDTO(
            expected_revision=source.revision, id="202704"
        ))
        derived = await admin.version("202702")
        assert derived.source_version_id == "202704" and derived.revision == 1
        with pytest.raises(HTTPException) as stale:
            await admin.delete("202702", PlanningVersionDeleteDTO(expected_revision=0))
        assert stale.value.status_code == 409
    finally:
        await session.close()

@pytest.mark.asyncio
async def test_comparison_summary_respects_submission_and_confirmation():
    session, _, budgets = await prepare()
    try:
        for budget in budgets:
            await submit(session, budget)
        for confirmed in (False, True):
            if confirmed:
                await act(session, "confirm")
            for role in ("lead", "management"):
                summary = await service(session, user("review@example.com", role)).get_workspace(
                    2027, version_id="202701", comparison_summary=True,
                )
                available = role == "lead" or confirmed
                assert len(summary["initiatives"]) == len(budgets)
                for item in summary["initiatives"]:
                    assert item["allocationVisible"] is available
                    assert item["allocationTotal"] == (100 if available else 0)
                    assert item["workflow"]["confirmed"] is confirmed
                    assert "rows" not in item and "editorState" not in item
    finally:
        await session.close()
