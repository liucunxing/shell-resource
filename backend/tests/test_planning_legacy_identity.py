"""Legacy snapshots remain immutable when a version adopts current dealer identities."""

from copy import deepcopy

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.dealer_identity import dealer_identity
from app.dependencies.workbench_user import WorkbenchUser
from app.models.do.budget import BudgetDO
from app.models.do.distributor_history import distributor_sellin_resource_history
from app.models.do.planning import PlanningVersionDO
from app.repositories.reference_repository import ReferenceRepository
from app.repositories.workspace_repository import WorkspaceRepository
from app.schemas.dto.planning import PlanningVersionCreateDTO, PlanningVersionUpdateDTO
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO, PublishDTO
from app.services.planning_service import PlanningService
from app.services.workspace_service import WorkspaceService
from test_workspace import _owner, _session, _workspace_service


async def legacy_submission(session):
    owner = _workspace_service(session, _owner())
    await owner.save_draft(
        1, InitiativeDraftUpdateDTO(expected_revision=0, rows=[{"dealerId": "d1", "amount": 100}])
    )
    await owner.publish(1, PublishDTO(expected_revision=1))
    publication = (await WorkspaceRepository(session).publications_for(1))[0]
    await session.execute(
        distributor_sellin_resource_history.update()
        .where(distributor_sellin_resource_history.c.distributor_code == "d1")
        .values(sd="SD-A", rsm="RSM-A")
    )
    await session.commit()
    return publication


@pytest.mark.asyncio
async def test_first_version_maps_unique_code_keeps_source_and_allows_admin_without_affiliation():
    session = await _session()
    try:
        publication = await legacy_submission(session)
        original_snapshot = deepcopy(publication.snapshot)
        # A second sector's dealer with the same code must not make this match ambiguous.
        await session.execute(distributor_sellin_resource_history.insert().values(
            distributor_code="d1", sector="CRTO", sd="OTHER", rsm="OTHER",
            distributor_status="1",
        ))
        await session.commit()
        administrator = WorkbenchUser("admin@example.com", "admin", None, "Admin")
        planning = PlanningService(session, administrator)
        await planning.create(PlanningVersionCreateDTO(
            id="202701", name="First", planning_year=2027,
        ))
        copied = await session.scalar(select(BudgetDO).where(
            BudgetDO.planning_version_id == "202701", BudgetDO.initiative_key == "1",
        ))
        records = await ReferenceRepository(session).list_dealers(["d1"], ("PCMO",))
        rows = await WorkspaceRepository(session).rows_for(copied.id)
        assert [(row.history_key, row.distributor_code, row.sd, row.rsm) for row in rows] == [
            (dealer_identity(records[0]), "d1", "SD-A", "RSM-A"),
        ]
        assert rows[0].distributor_budget_amount == 100
        assert publication.snapshot == original_snapshot
        old_rows = await WorkspaceRepository(session).rows_for(1)
        assert old_rows[0].history_key is None and old_rows[0].distributor_code == "d1"
        await planning.update("202701", PlanningVersionUpdateDTO(
            expected_revision=0, published=True, open=True,
        ))
        submitted = await WorkspaceService(session, _owner()).publish(
            copied.id, PublishDTO(expected_revision=0),
        )
        assert submitted["initiative"]["rows"][0]["dealerId"] == dealer_identity(records[0])
        workspace = await WorkspaceService(session, administrator).get_workspace(2027)
        assert workspace["state"]["planningVersion"]["id"] == "202701"
    finally:
        await session.close()
        await session.bind.dispose()


@pytest.mark.asyncio
async def test_ambiguous_legacy_code_requires_reselection_before_creating_any_version():
    session = await _session()
    try:
        publication = await legacy_submission(session)
        original_snapshot = deepcopy(publication.snapshot)
        await session.execute(distributor_sellin_resource_history.insert().values(
            distributor_code="d1", sector="PCMO", sd="SD-B", rsm="RSM-B",
            distributor_status="1",
        ))
        await session.commit()
        planning = PlanningService(
            session, WorkbenchUser("admin@example.com", "admin", None, "Admin"),
        )
        with pytest.raises(HTTPException) as blocked:
            await planning.create(PlanningVersionCreateDTO(
                id="202701", name="First", planning_year=2027,
            ))
        assert blocked.value.status_code == 422
        assert "d1" in blocked.value.detail and "重新选择" in blocked.value.detail
        assert await session.get(PlanningVersionDO, "202701") is None
        assert publication.snapshot == original_snapshot
        assert not list(await session.scalars(select(BudgetDO).where(
            BudgetDO.planning_version_id == "202701",
        )))
    finally:
        await session.close()
        await session.bind.dispose()


@pytest.mark.asyncio
async def test_copy_does_not_merge_legacy_and_current_rows_for_the_same_identity():
    session = await _session()
    try:
        await legacy_submission(session)
        record = (await ReferenceRepository(session).list_dealers(["d1"], ("PCMO",)))[0]
        owner = WorkspaceService(session, _owner())
        saved = await owner.save_draft(1, InitiativeDraftUpdateDTO(
            expected_revision=1,
            rows=[
                {"dealerId": "d1", "amount": 40},
                {"dealerId": dealer_identity(record), "amount": 60},
            ],
        ))
        await owner.publish(1, PublishDTO(expected_revision=saved["revision"]))
        publication = (await WorkspaceRepository(session).publications_for(1))[-1]
        original_snapshot = deepcopy(publication.snapshot)
        planning = PlanningService(
            session, WorkbenchUser("admin@example.com", "admin", None, "Admin"),
        )
        with pytest.raises(HTTPException) as blocked:
            await planning.create(PlanningVersionCreateDTO(
                id="202701", name="First", planning_year=2027,
            ))
        assert blocked.value.status_code == 422
        assert "同一经销商" in blocked.value.detail and "重新选择" in blocked.value.detail
        assert publication.snapshot == original_snapshot
        assert await session.get(PlanningVersionDO, "202701") is None
    finally:
        await session.close()
        await session.bind.dispose()
