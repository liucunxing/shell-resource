import asyncio

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.base import BaseDO
from app.models.do.budget import BudgetDO
from app.models.do.workspace import (
    BudgetChangeLogDO,
    UserPermissionDO,
    WorkspaceConfigDO,
    WorkspacePublicationDO,
    WorkspaceReferenceDO,
)
from app.schemas.dto.workbench import (
    AdminBudgetsCreateDTO,
    AdminBudgetsUpdateDTO,
    AdminConfigDTO,
    ReferenceImportDTO,
)
from app.services.admin_service import AdminService
from app.services.reference_service import ReferenceService


async def database_case(callback):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.execute(text("ATTACH DATABASE ':memory:' AS data"))
        await connection.run_sync(BaseDO.metadata.create_all)
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            user = WorkbenchUser("admin@example.com", "admin", None, None, "Admin")
            await callback(session, AdminService(session, user))
    finally:
        await engine.dispose()


def reference(revision=0, batch="B1", dealer="D1"):
    return ReferenceImportDTO(
        expected_revision=revision,
        batchId=batch,
        asOf="2026-09-23",
        dealers=[
            {
                "id": dealer,
                "name": None,
                "history": {
                    "c32025": 100,
                    "vol2025": None,
                    "resources2025": {"MRD": 10, "SP&A": 10, "ICE Rebate": 20, "Capex": 10},
                },
            }
        ],
    )


def test_reference_reimport_replaces_and_scopes_history():
    async def run(session, service):
        first = await service.import_reference(reference())
        second = await service.import_reference(reference(first["revision"], "B2", "D2"))
        assert second["batchId"] == "B2" and second["importedAt"]
        assert await session.scalar(select(func.count()).select_from(WorkspaceReferenceDO)) == 1
        assert await ReferenceService(session).get_dealers(2027, "MKT", ["D1"]) == []
        dealers = await ReferenceService(session).get_dealers(2027, "MKT", ["D2"])
        history = dealers[0]["history"]
        assert history["resources2025"] == {"MRD": 10.0, "SP&A": 10.0}
        assert history["yield2025"] == 2.0 and history["vol2025"] is None
        assert "resource2025" not in history
        assert dealers[0]["name"] is None
        assert "api_key" not in str(dealers)
        config = await session.get(WorkspaceConfigDO, 1)
        assert config.reference["batchId"] == "B2"

    asyncio.run(database_case(run))


def test_reference_failure_rolls_back_delete_and_metadata():
    async def run(session, service):
        await service.import_reference(reference())
        original = service.repository.add_log

        def fail(*args):
            raise RuntimeError("injected failure after delete and insert")

        service.repository.add_log = fail
        with pytest.raises(RuntimeError):
            await service.import_reference(reference(1, "B2", "D2"))
        service.repository.add_log = original
        dealers = await ReferenceService(session).get_dealers(2027, "MKT")
        assert [dealer["id"] for dealer in dealers] == ["D1"]
        config = await session.get(WorkspaceConfigDO, 1)
        assert config.revision == 1 and config.reference["batchId"] == "B1"
        assert await session.scalar(select(func.count()).select_from(BudgetChangeLogDO)) == 1

    asyncio.run(database_case(run))


@pytest.mark.parametrize(
    "history",
    [
        {"c32025": -1},
        {"c32025": "NaN"},
        {"vol2024": float("inf")},
        {"resources2025": {"secret": 100}},
        {"resource2025": 300},
        {"c32025": True},
    ],
)
def test_reference_rejects_invalid_source_values(history):
    data = reference().model_dump()
    data["dealers"][0]["history"] = history
    with pytest.raises(ValidationError):
        ReferenceImportDTO.model_validate(data)


def test_duplicate_source_dealers_and_budget_ids_rejected():
    data = reference().model_dump()
    data["dealers"].append(data["dealers"][0])
    with pytest.raises(ValidationError):
        ReferenceImportDTO.model_validate(data)
    item = {"id": 1, "expected_revision": 0, "budget": 100, "ownerId": "o@x.com"}
    with pytest.raises(ValidationError):
        AdminBudgetsUpdateDTO(items=[item, item])


async def seed_budget(session):
    session.add(
        UserPermissionDO(
            email="owner@example.com",
            display_name="Owner",
            role="owner",
            department="MKT",
            sector="PCMO",
            enabled=True,
        )
    )
    session.add(
        BudgetDO(
            id=1,
            planning_year=2027,
            sector="PCMO",
            department="MKT",
            resource_type="MRD",
            initiative_name="Plan",
            plan_budget_amount=100,
            allocate_budget_amount=70,
            owner_email="owner@example.com",
            revision=3,
            status=0,
            input_source="ADMIN",
        )
    )
    session.add(
        WorkspacePublicationDO(
            budget_id=1,
            department="MKT",
            publication_number=1,
            published_revision=3,
            snapshot={"budget": 100},
        )
    )
    await session.commit()


def test_admin_budget_revision_and_atomic_validation():
    async def run(session, service):
        await seed_budget(session)
        item = {"id": 1, "expected_revision": 3, "budget": 200, "ownerId": "owner@example.com"}
        bad = {**item, "id": 2}
        with pytest.raises(HTTPException) as error:
            await service.update_budgets(AdminBudgetsUpdateDTO(items=[item, bad]))
        assert error.value.status_code == 422
        budget = await session.get(BudgetDO, 1)
        assert budget.revision == 3 and budget.plan_budget_amount == 100
        await service.update_budgets(AdminBudgetsUpdateDTO(items=[item]))
        budget = await session.get(BudgetDO, 1)
        assert budget.revision == 4 and budget.plan_budget_amount == 200
        assert budget.allocate_budget_amount == 70
        snapshot = await session.scalar(select(WorkspacePublicationDO))
        assert snapshot.snapshot == {"budget": 100}
        with pytest.raises(HTTPException) as error:
            await service.update_budgets(AdminBudgetsUpdateDTO(items=[item]))
        assert error.value.status_code == 409

    asyncio.run(database_case(run))


def test_admin_unchanged_batch_does_not_increment_revision():
    async def run(session, service):
        await seed_budget(session)
        result = await service.update_budgets(
            AdminBudgetsUpdateDTO(
                items=[
                    {"id": 1, "expected_revision": 3, "budget": 100, "ownerId": "owner@example.com"}
                ]
            )
        )
        assert result["updated_count"] == 0
        assert (await session.get(BudgetDO, 1)).revision == 3
        assert await session.scalar(select(func.count()).select_from(BudgetChangeLogDO)) == 0

    asyncio.run(database_case(run))


def test_duplicate_admin_create_rolls_back_whole_batch():
    async def run(session, service):
        await seed_budget(session)
        item = {
            "name": "New",
            "resourceType": "MRD",
            "sector": "PCMO",
            "department": "MKT",
            "budget": 100,
            "ownerId": "owner@example.com",
        }
        with pytest.raises(HTTPException) as error:
            await service.create_budgets(
                AdminBudgetsCreateDTO(planning_year=2027, items=[item, item])
            )
        assert error.value.status_code == 409
        assert await session.scalar(select(func.count()).select_from(BudgetDO)) == 1

    asyncio.run(database_case(run))


@pytest.mark.parametrize(
    "role,enabled,department,sector",
    [
        ("lead", True, "MKT", "PCMO"),
        ("owner", False, "MKT", "PCMO"),
        ("owner", True, "ICE", "PCMO"),
        ("owner", True, "MKT", "OTHER"),
    ],
)
def test_admin_rejects_invalid_owner(role, enabled, department, sector):
    async def run(session, service):
        await seed_budget(session)
        owner = await session.scalar(select(UserPermissionDO))
        owner.role, owner.enabled, owner.department, owner.sector = (
            role,
            enabled,
            department,
            sector,
        )
        await session.commit()
        with pytest.raises(HTTPException) as error:
            await service.update_budgets(
                AdminBudgetsUpdateDTO(
                    items=[{"id": 1, "expected_revision": 3, "budget": 200, "ownerId": owner.email}]
                )
            )
        assert error.value.status_code == 422
        assert (await session.get(BudgetDO, 1)).revision == 3

    asyncio.run(database_case(run))


def test_config_initializes_and_server_versions_guide():
    async def run(session, service):
        first = await service.update_config(
            AdminConfigDTO(expected_revision=0, guide={"version": 999, "text": "Guide"})
        )
        assert first["revision"] == 1 and first["guide"]["version"] < 999
        assert len(first["budgetReasons"]) == 3
        second = await service.update_config(
            AdminConfigDTO(expected_revision=1, guide={"version": -20, "text": "Updated"})
        )
        assert second["guide"]["version"] == first["guide"]["version"] + 1
        with pytest.raises(HTTPException) as error:
            await service.update_config(AdminConfigDTO(expected_revision=1))
        assert error.value.status_code == 409

    asyncio.run(database_case(run))


@pytest.mark.parametrize(
    "reasons",
    [
        [{"id": "x", "label": "", "enabled": True}],
        [{"id": "x", "label": "Valid", "enabled": "false"}],
        [{"id": "x", "label": "Valid", "enabled": True}] * 2,
    ],
)
def test_config_reason_validation(reasons):
    with pytest.raises(ValidationError):
        AdminConfigDTO(expected_revision=0, budgetReasons=reasons)


@pytest.mark.parametrize("resources", [{}, {"MRD": 0, "SP&A": 0, "ICE Rebate": 0, "Capex": 0}])
def test_reference_missing_and_zero_denominator_remain_unknown(resources):
    async def run(session, service):
        data = reference().model_dump()
        data["dealers"][0]["history"]["resources2025"] = resources
        await service.import_reference(ReferenceImportDTO.model_validate(data))
        dealer = (await ReferenceService(session).get_dealers(2027, "MKT"))[0]
        assert dealer["history"]["yield2025"] is None
        assert dealer["history"]["c32024"] is None

    asyncio.run(database_case(run))
