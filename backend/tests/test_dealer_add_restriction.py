"""Selecting existing Active dealers is allowed; source creation remains unavailable."""

import pytest
from fastapi import HTTPException

from app.models.do.distributor_history import distributor_sellin_resource_history
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO, PublishDTO
from app.services.workspace_service import WorkspaceService
from test_planning_workflow import prepare, user


@pytest.mark.asyncio
async def test_empty_plan_can_select_save_read_remove_and_reselect_active_dealers():
    session, _, budgets = await prepare()
    try:
        budget = budgets[0]
        service = WorkspaceService(session, user(budget.owner_email))
        assert (await service.get_draft(budget.id))["rows"] == []
        saved = await service.save_draft(budget.id, InitiativeDraftUpdateDTO(
            expected_revision=budget.revision,
            rows=[{"dealerId": "d1", "amount": 0}, {"dealerId": "d2", "amount": 25}],
        ))
        reread = await service.get_draft(budget.id)
        assert {row["dealerId"]: row["amount"] for row in reread["rows"]} == {
            "d1": 0, "d2": 25,
        }
        emptied = await service.save_draft(budget.id, InitiativeDraftUpdateDTO(
            expected_revision=saved["revision"], rows=[],
        ))
        assert (await service.get_draft(budget.id))["rows"] == []
        reselected = await service.save_draft(budget.id, InitiativeDraftUpdateDTO(
            expected_revision=emptied["revision"], rows=[{"dealerId": "d1", "amount": 100}],
        ))
        await service.publish(budget.id, PublishDTO(expected_revision=reselected["revision"]))
        revised = await service.save_draft(budget.id, InitiativeDraftUpdateDTO(
            expected_revision=reselected["revision"],
            rows=[{"dealerId": "d1", "amount": 100}, {"dealerId": "d2", "amount": 0}],
        ))
        assert revised["workflow"]["editable"]
        assert not revised["workflow"]["submitted"]
    finally:
        await session.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("dealer_id", ["d2", "d3", "missing"])
async def test_selection_rejects_closed_cross_sector_and_unknown_dealers(dealer_id):
    session, _, budgets = await prepare()
    try:
        await session.execute(distributor_sellin_resource_history.update().where(
            distributor_sellin_resource_history.c.distributor_code == "d2",
        ).values(distributor_status="closed"))
        await session.commit()
        budget = budgets[0]
        service = WorkspaceService(session, user(budget.owner_email))
        with pytest.raises(HTTPException) as denied:
            await service.save_draft(budget.id, InitiativeDraftUpdateDTO(
                expected_revision=budget.revision, rows=[{"dealerId": dealer_id, "amount": 0}],
            ))
        assert denied.value.status_code == 422
        assert (await service.get_draft(budget.id))["rows"] == []
    finally:
        await session.close()
