"""Extending a deadline refreshes permissions without releasing other locks."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.schemas.dto.planning import PlanningVersionUpdateDTO
from app.services.planning_service import PlanningService
from test_planning_workflow import act, prepare, service, submit, user


@pytest.mark.asyncio
async def test_historical_deadline_does_not_block_owner_save_or_submit():
    session, admin, budgets = await prepare()
    try:
        version = await admin.version("202701")
        version.deadline = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()
        owner = service(session, user(budgets[0].owner_email))
        workspace = await owner.get_workspace(2027, version_id=version.id)
        assert "deadline" not in workspace["state"]["planningVersion"]
        assert workspace["state"]["initiatives"][0]["editable"]
        await submit(session, budgets[0])
        assert (await owner.get_draft(budgets[0].id))["workflow"]["submitted"]
    finally:
        await session.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("barrier", ["stopped", "department_confirmed"])
async def test_historical_deadline_does_not_bypass_version_and_department_locks(barrier):
    session, admin, budgets = await prepare()
    try:
        if barrier == "department_confirmed":
            for budget in budgets:
                await submit(session, budget)
            await act(session, "confirm")
        version = await admin.version("202701")
        if barrier == "stopped":
            await admin.update(version.id, PlanningVersionUpdateDTO(
                expected_revision=version.revision, open=False,
            ))
        version.deadline = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()
        assert version.open is (barrier == "department_confirmed")
        draft = await service(session, user(budgets[0].owner_email)).get_draft(budgets[0].id)
        assert not draft["workflow"]["editable"]
        with pytest.raises(HTTPException) as blocked:
            await submit(session, budgets[0])
        assert blocked.value.status_code == 409
        if barrier == "department_confirmed":
            lead = PlanningService(session, user("lead@example.com", "lead"))
            department = await lead.department(version.id, "PCMO", "MKT")
            assert department["confirmed"] == 2 and department["canWithdraw"]
    finally:
        await session.close()
