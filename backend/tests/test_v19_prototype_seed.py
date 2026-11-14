"""Prototype import, workflow and unit conversion tests using SQLite only."""

from decimal import Decimal
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from tests.v19_prototype_seed import load_prototype, preview_users, seed_prototype

from app.dependencies.workbench_user import resolve_workbench_permission
from app.models.do import BaseDO
from app.models.do.budget import BudgetDO
from app.models.do.budget_distributor import BudgetDistributorDO
from app.models.do.distributor_history import distributor_sellin_resource_history
from app.models.do.planning import InitiativeWorkflowDO, PlanningVersionDO
from app.models.do.workspace import (
    OtherBudgetDO,
    UserPermissionDO,
    WorkspaceConfigDO,
    WorkspacePublicationDO,
)
from app.schemas.dto.planning import DepartmentActionDTO
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO, PublishDTO
from app.services.planning_service import PlanningService
from app.services.reference_service import ReferenceService
from app.services.workspace_service import WorkspaceService


@pytest_asyncio.fixture
async def seeded():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def attach(connection, _):
        connection.execute("ATTACH DATABASE ':memory:' AS data")

    async with engine.begin() as connection:
        await connection.run_sync(BaseDO.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        prototype = load_prototype()
        manifest = await seed_prototype(session, prototype)
        yield session, prototype, manifest
    await engine.dispose()


@pytest.mark.asyncio
async def test_source_budgets_selections_reserves_and_submissions_are_preserved(seeded):
    session, prototype, manifest = seeded
    budgets = (await session.scalars(select(BudgetDO))).all()
    assert len(budgets) == 49
    assert await session.scalar(select(func.count()).select_from(WorkspacePublicationDO)) == 46
    for budget in budgets:
        source_version = next(
            v for v in prototype["db"]["versions"] if v["id"] == budget.planning_version_id
        )
        source = next(p for p in source_version["catalog"] if p["id"] == budget.initiative_key)
        assert budget.plan_budget_amount == source["budget"]
        assert budget.enabled == source["enabled"]
        assert budget.planning_year == 2027  # 202612 is a 2027 planning version, not FY2026.
        draft = prototype["db"]["drafts"].get(
            f"{budget.planning_version_id}|{budget.initiative_key}", {}
        )
        rows = (
            await session.scalars(
                select(BudgetDistributorDO).where(BudgetDistributorDO.budget_id == budget.id)
            )
        ).all()
        other = (
            await session.scalars(select(OtherBudgetDO).where(OtherBudgetDO.budget_id == budget.id))
        ).all()
        assert {row.distributor_code for row in rows} == set(draft.get("selected", []))
        assert {row.distributor_code: int(row.distributor_budget_amount) for row in rows} == {
            code: draft["amounts"].get(code, 0) for code in draft.get("selected", [])
        }
        assert sum(row.amount for row in other) == sum(
            reserve["amount"] for reserve in draft.get("reserves", [])
        )
        if draft:
            assert (
                sum(row.distributor_budget_amount for row in rows)
                + sum(row.amount for row in other)
                == budget.plan_budget_amount
            )
    assert [version["budgetCny"] for version in manifest["versions"]] == [51520000, 52220000]
    assert manifest["sourceDealerCount"] == 120
    assert manifest["historyIdentityCount"] == 480
    config = await session.get(WorkspaceConfigDO, 1)
    reasons = {reason["id"]: reason for reason in config.budget_reasons}
    assert {"reserve", "unallocated", "other"}.issubset(reasons)
    assert all(reasons[key]["enabled"] for key in ("reserve", "unallocated", "other"))
    assert {reason["label"] for key, reason in reasons.items() if key.startswith("v19-")} == {
        reason["name"] for reason in prototype["reserveReasons"]
    }
    assert len(config.budget_reasons) == 11
    assert len(manifest["derivedLocalConfiguration"]["addedSystemReasons"]) == 3


@pytest.mark.asyncio
async def test_historical_units_use_ytd_snapshot_and_keep_missing_api_fields_honest(seeded):
    session, prototype, manifest = seeded
    history = distributor_sellin_resource_history
    first = (
        (
            await session.execute(
                select(history).where(
                    history.c.distributor_code == "D1001", history.c.sector == "PCMO"
                )
            )
        )
        .mappings()
        .one()
    )
    assert first["volume_2025"] == Decimal("6096000")  # 6096 KL -> L
    assert first["c3_2025"] == Decimal("4570815")  # raw USD, not KUSD
    assert first["volume_2026"] == Decimal("5348000")
    assert first["c3_2026"] == Decimal("4010314")
    assert first["c3_2026"] != prototype["dealers"][0]["c26"]
    admin = await resolve_workbench_permission(session, "v19-u31@example.test")
    dealer = next(
        d
        for d in await ReferenceService(session).get_dealers(2027, user=admin)
        if d["code"] == "D1001" and d["sector"] == "PCMO"
    )
    assert sum(dealer["history"]["resources2026Ytd"].values()) == 1503326
    assert dealer["history"]["yield2026Ytd"] is None
    assert "contractVolume" not in dealer["history"]
    assert manifest["sourceHistoryManifest"]["datasets"]["actual"]["latestMonth"] == "2026-10"


@pytest.mark.asyncio
async def test_synthetic_identities_and_role_views_match_source_workflow(seeded):
    session, prototype, manifest = seeded
    choices, default = preview_users(prototype)
    assert default == "v19-u01@example.test"
    assert choices[0]["label"] == "王磊 · Owner"
    assert len(choices) == 10
    users = (await session.scalars(select(UserPermissionDO))).all()
    assert all(user.email.endswith("@example.test") for user in users)
    for source, imported in zip(prototype["db"]["versions"], manifest["versions"], strict=True):
        version = await session.get(PlanningVersionDO, source["id"])
        assert version.open == source["open"]
        assert version.published == source["published"]
        assert imported["submissions"] == (24 if source["id"] == "202612" else 22)
    owner = await resolve_workbench_permission(session, default)
    workspace = await WorkspaceService(session, owner).get_workspace(2027)
    assert workspace["state"]["currentVersionId"] == "202701"
    source_projects = prototype["db"]["versions"][1]["catalog"]
    expected = {p["id"] for p in source_projects if p["owner"] == "王磊" and p["enabled"]}
    assert {p["initiativeKey"] for p in workspace["state"]["initiatives"]} == expected
    assert owner.affiliation_sector == "PCMO" and owner.affiliation_department == "MKT"
    assert set(owner.departments) == {"MKT", "ICE"}
    assert owner.history_resources == ()  # Preserve original prototype expense access.
    manager = await resolve_workbench_permission(session, "v19-u21@example.test")
    baseline = await WorkspaceService(session, manager).get_workspace(2027, version_id="202612")
    assert len(baseline["state"]["initiatives"]) == 24
    assert all(item["allocationVisible"] for item in baseline["state"]["initiatives"])
    current = await WorkspaceService(session, manager).get_workspace(2027, version_id="202701")
    assert not any(item["workflow"]["confirmed"] for item in current["state"]["initiatives"])
    assert not any(item["allocationVisible"] for item in current["state"]["initiatives"])
    assert sum(p["confirmedProjects"] for p in manifest["derivedLocalPreparation"]) == 24


@pytest.mark.asyncio
async def test_imported_submission_can_return_edit_resubmit_and_confirm_through_services(seeded):
    session, _, _ = seeded
    lead = await resolve_workbench_permission(session, "v19-u12@example.test")
    planner = PlanningService(session, lead)
    version = await planner.version("202701")
    department = await planner.department("202701", "PCMO", "ICE")
    assert department["canConfirm"]
    budget_id = int(department["items"][0]["id"])
    await planner.department_action(
        "202701",
        "return",
        DepartmentActionDTO(
            sector="PCMO",
            department="ICE",
            expected_revision=version.revision,
            initiative_id=budget_id,
            reason="本地闭环验证",
        ),
    )
    budget = await session.get(BudgetDO, budget_id)
    owner = await resolve_workbench_permission(session, budget.owner_email)
    service = WorkspaceService(session, owner)
    workspace = await service.get_workspace(2027)
    initiative = next(p for p in workspace["state"]["initiatives"] if p["id"] == str(budget_id))
    assert initiative["editable"]
    saved = await service.save_draft(
        budget_id,
        InitiativeDraftUpdateDTO(
            expected_revision=initiative["revision"],
            rows=initiative["rows"],
            otherBudgets=initiative["otherBudgets"],
            changeReason="按原名单复核后提交，本地流程测试",
        ),
    )
    await service.publish(budget_id, PublishDTO(expected_revision=saved["revision"]))
    version = await planner.version("202701")
    result = await planner.department_action(
        "202701",
        "confirm",
        DepartmentActionDTO(
            sector="PCMO",
            department="ICE",
            expected_revision=version.revision,
        ),
    )
    assert result["confirmed"] == result["total"]
    state = await session.get(InitiativeWorkflowDO, budget_id)
    assert state.confirmed_publication_id == state.publication_id
    assert state.confirmed_by == lead.email


@pytest.mark.asyncio
async def test_import_rejects_remote_dialects_before_any_database_operation():
    class RemoteSession:
        def get_bind(self):
            return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

    with pytest.raises(ValueError, match="restricted to local SQLite"):
        await seed_prototype(RemoteSession(), {})


@pytest.mark.asyncio
async def test_import_refuses_to_replace_existing_local_data(seeded):
    session, prototype, _ = seeded
    with pytest.raises(ValueError, match="empty fixture"):
        await seed_prototype(session, prototype)
