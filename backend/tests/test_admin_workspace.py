import asyncio

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.base import BaseDO
from app.models.do.budget import BudgetDO
from app.models.do.distributor_history import distributor_sellin_resource_history
from app.models.do.workspace import (
    BudgetChangeLogDO,
    UserPermissionDO,
    WorkspaceConfigDO,
    WorkspacePublicationDO,
    WorkspaceReferenceDO,
)
from app.schemas.dto.workbench import (
    AdminBudgetsCreateDTO,
    AdminBudgetsImportDTO,
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
            user = WorkbenchUser("admin@example.com", "admin", None, "Admin")
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
        legacy = (await session.scalars(select(WorkspaceReferenceDO))).one()
        assert legacy.dealer_id == "D1"
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


def test_owner_can_receive_initiatives_in_multiple_sectors():
    async def run(session, service):
        await seed_budget(session)
        result = await service.create_budgets(
            AdminBudgetsCreateDTO(
                planning_year=2027,
                items=[
                    {
                        "name": "Other sector",
                        "resourceType": "MRD",
                        "sector": "OTHER",
                        "department": "MKT",
                        "budget": 50,
                        "ownerId": "owner@example.com",
                    }
                ],
            )
        )
        assert result["created_count"] == 1
        budgets = (await session.scalars(select(BudgetDO).order_by(BudgetDO.id))).all()
        assert {budget.sector for budget in budgets} == {"PCMO", "OTHER"}
        assert {budget.owner_email for budget in budgets} == {"owner@example.com"}

    asyncio.run(database_case(run))


@pytest.mark.parametrize(
    "role,enabled,department",
    [
        ("lead", True, "MKT"),
        ("owner", False, "MKT"),
        ("owner", True, "ICE"),
    ],
)
def test_admin_rejects_invalid_owner(role, enabled, department):
    async def run(session, service):
        await seed_budget(session)
        owner = await session.scalar(select(UserPermissionDO))
        owner.role, owner.enabled, owner.department = role, enabled, department
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


def test_distributor_history_field_mapping_and_department_scope():
    async def run(session, service):
        await session.execute(
            distributor_sellin_resource_history.insert().values(
                distributor_code="D-HISTORY",
                distributor_name="History Dealer",
                volume_2024=1,
                c3_2024=2,
                volume_2025=3,
                c3_2025=4,
                volume_2026=5,
                c3_2026=6,
                mrd_2025=7,
                reb_2025=8,
                btl_2025=9,
                capex_2025=10,
                yield_2025=11,
                resource_total=34,
                resource_uc3=12,
            )
        )
        await session.commit()
        dealer = (await ReferenceService(session).get_dealers(2027, "MKT"))[0]
        assert dealer == {
            "id": "D-HISTORY",
            "name": "History Dealer",
            "history": {
                "vol2024": 1.0,
                "c32024": 2.0,
                "vol2025": 3.0,
                "c32025": 4.0,
                "vol2026Ytd": 5.0,
                "c32026Ytd": 6.0,
                "yield2025": 11.0,
                "resource2025": 34.0,
                "resourcePerLiter2025": 12.0,
                "resources2025": {"MRD": 7.0, "SP&A": 9.0},
            },
        }
        ice = (await ReferenceService(session).get_dealers(2027, "ICE"))[0]
        assert ice["history"]["resources2025"] == {"ICE Rebate": 8.0}

    asyncio.run(database_case(run))


def test_mixed_admin_import_is_atomic_and_creates_new_initiative():
    async def run(session, service):
        await seed_budget(session)
        update = {
            "id": 1,
            "expected_revision": 3,
            "budget": 200,
            "ownerId": "owner@example.com",
        }
        duplicate = {
            "name": "Plan",
            "resourceType": "MRD",
            "sector": "PCMO",
            "department": "MKT",
            "budget": 50,
            "ownerId": "owner@example.com",
        }
        with pytest.raises(HTTPException) as error:
            await service.import_budgets(
                AdminBudgetsImportDTO(
                    planning_year=2027,
                    updates=[update],
                    creates=[duplicate],
                )
            )
        assert error.value.status_code == 409
        original = await session.get(BudgetDO, 1)
        assert original.revision == 3 and original.plan_budget_amount == 100
        assert await session.scalar(select(func.count()).select_from(BudgetDO)) == 1

        invalid_resource = {
            **duplicate,
            "name": "Invalid resource",
            "resourceType": "ICE Rebate",
        }
        with pytest.raises(HTTPException) as error:
            await service.import_budgets(
                AdminBudgetsImportDTO(
                    planning_year=2027,
                    updates=[update],
                    creates=[invalid_resource],
                )
            )
        assert error.value.status_code == 422
        original = await session.get(BudgetDO, 1)
        assert original.revision == 3 and original.plan_budget_amount == 100
        assert await session.scalar(select(func.count()).select_from(BudgetDO)) == 1

        created = {**duplicate, "name": "New Initiative"}
        result = await service.import_budgets(
            AdminBudgetsImportDTO(
                planning_year=2027,
                updates=[update],
                creates=[created],
            )
        )
        assert result == {"updated_count": 1, "created_count": 1}
        original = await session.get(BudgetDO, 1)
        assert original.revision == 4 and original.plan_budget_amount == 200
        initiatives = (await session.scalars(select(BudgetDO).order_by(BudgetDO.id))).all()
        assert len(initiatives) == 2
        assert initiatives[1].initiative_name == "New Initiative"
        assert initiatives[1].revision == 0 and initiatives[1].allocate_budget_amount == 0

    asyncio.run(database_case(run))
