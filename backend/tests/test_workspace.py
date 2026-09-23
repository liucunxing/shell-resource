"""SQLite attached-schema service tests; they exercise transactions, not PostgreSQL DDL."""

from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.base import BaseDO
from app.models.do.budget import BudgetDO
from app.models.do.workspace import UserPermissionDO, WorkspaceConfigDO, WorkspaceReferenceDO
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO, PublishDTO
from app.services.workspace_service import WorkspaceService


async def _session() -> AsyncSession:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.exec_driver_sql("ATTACH DATABASE ':memory:' AS data")
        await connection.run_sync(BaseDO.metadata.create_all)
    session = AsyncSession(engine, expire_on_commit=False)
    session.add_all(
        [
            BudgetDO(
                id=1,
                planning_year=2027,
                sector="S",
                department="MKT",
                resource_type="R",
                initiative_name="A",
                plan_budget_amount=Decimal("100"),
                allocate_budget_amount=0,
                owner_email="a@example.com",
                revision=0,
                status=0,
                input_source="TEST",
            ),
            BudgetDO(
                id=2,
                planning_year=2027,
                sector="S",
                department="MKT",
                resource_type="R",
                initiative_name="B",
                plan_budget_amount=Decimal("100"),
                allocate_budget_amount=0,
                owner_email="b@example.com",
                revision=0,
                status=0,
                input_source="TEST",
            ),
            UserPermissionDO(
                id=1,
                email="a@example.com",
                display_name="A",
                role="owner",
                department="MKT",
                sector="S",
                enabled=True,
            ),
            WorkspaceReferenceDO(
                id=1, planning_year=2027, batch_id="test", as_of="2026", dealer_id="d1"
            ),
            WorkspaceReferenceDO(
                id=2, planning_year=2027, batch_id="test", as_of="2026", dealer_id="d2"
            ),
            WorkspaceConfigDO(
                id=1,
                revision=0,
                budget_reasons=[{"id": "misc", "enabled": True}],
                budget_reason_version=1,
                guide={"version": 3, "text": "g"},
                reference={},
            ),
        ]
    )
    await session.commit()
    return session


def _owner() -> WorkbenchUser:
    return WorkbenchUser("a@example.com", "owner", "MKT", "S", "A")


@pytest.mark.asyncio
async def test_owner_isolated_revision_and_immutable_publish() -> None:
    session = await _session()
    service = WorkspaceService(session, _owner())
    payload = InitiativeDraftUpdateDTO(
        expected_revision=0, rows=[{"dealerId": "d1", "amount": "100", "note": "x"}]
    )
    saved = await service.save_draft(1, payload)
    assert saved["revision"] == 1
    with pytest.raises(HTTPException) as blocked:
        await service.get_draft(2)
    assert blocked.value.status_code == 404
    with pytest.raises(HTTPException) as stale:
        await service.save_draft(1, payload)
    assert stale.value.status_code == 409
    publication = await service.publish(1, PublishDTO(expected_revision=1, note="ok"))
    assert publication["publishedRevision"] == 1
    await service.save_draft(1, InitiativeDraftUpdateDTO(expected_revision=1, rows=[]))
    history = await service.publications(1)
    assert history[0]["initiative"]["rows"][0]["amount"] == 100.0
    await session.close()


@pytest.mark.asyncio
async def test_role_read_boundaries() -> None:
    session = await _session()
    lead = WorkspaceService(session, WorkbenchUser("lead@example.com", "lead", "MKT", "S", "Lead"))
    assert (await lead.get_draft(1))["id"] == "1"
    assert await lead.publications(1) == []
    with pytest.raises(HTTPException) as denied:
        await lead.save_draft(1, InitiativeDraftUpdateDTO(expected_revision=0))
    assert denied.value.status_code == 403
    for role in ("management", "admin"):
        service = WorkspaceService(session, WorkbenchUser("x@example.com", role, "MKT", "S", "X"))
        with pytest.raises(HTTPException) as denied:
            await service.get_draft(1)
        assert denied.value.status_code == 403
    await session.close()


@pytest.mark.asyncio
async def test_reference_metadata_is_scoped_to_workspace_and_snapshot_year() -> None:
    session = await _session()
    config = await session.get(WorkspaceConfigDO, 1)
    config.reference = {"batchId": "2028-batch", "planningYear": 2028, "importedAt": "2027-01"}
    session.add(
        WorkspaceReferenceDO(
            planning_year=2028, batch_id="2028-batch", as_of="2027", dealer_id="d1"
        )
    )
    await session.commit()
    service = WorkspaceService(session, _owner())
    result = await service.get_workspace(2027)
    assert result["state"]["reference"] == {
        "batchId": "test",
        "asOf": "2026",
        "planningYear": 2027,
        "count": 2,
    }
    await service.save_draft(
        1, InitiativeDraftUpdateDTO(expected_revision=0, rows=[{"dealerId": "d1", "amount": "100"}])
    )
    published = await service.publish(1, PublishDTO(expected_revision=1))
    assert published["reference"] == result["state"]["reference"]
    later = await service.get_workspace(2028)
    assert later["state"]["reference"]["importedAt"] == "2027-01"
    assert (await service.get_workspace(2029))["state"]["reference"] == {}
    await session.close()
