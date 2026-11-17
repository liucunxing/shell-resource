"""Editor progress is saved per Initiative/version through the normal draft guards."""

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.models.do.budget import BudgetDO
from app.schemas.dto.planning import PlanningVersionCreateDTO
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO, PublishDTO
from test_planning_workflow import act, prepare, service, submit, user

EDITOR_STATE = {"step": 3, "reserveAcknowledgement": '{"budget":100,"reserves":[]}'}


def draft(revision, **values):
    return InitiativeDraftUpdateDTO(
        expected_revision=revision,
        rows=[{"dealerId": "d1", "amount": 100}],
        **values,
    )


@pytest.mark.asyncio
async def test_editor_state_roundtrip_omission_clear_and_initiative_isolation():
    session, _, budgets = await prepare()
    try:
        first, second = budgets
        # Two initiatives owned by the same person reproduce the project switch.
        second.owner_email = first.owner_email
        await session.commit()
        owner = service(session, user())
        saved = await owner.save_draft(first.id, draft(0, editorState=EDITOR_STATE))
        second_state = {"step": 1, "reserveAcknowledgement": "checked-second-project"}
        await owner.save_draft(second.id, draft(0, editorState=second_state))
        session.expire_all()
        loaded = await owner.get_draft(int(saved["id"]))
        assert loaded["editorState"] == EDITOR_STATE
        assert loaded["rows"][0]["amount"] == 100
        workspace = await owner.get_workspace(2027, version_id="202701")
        states = {item["id"]: item["editorState"] for item in workspace["state"]["initiatives"]}
        assert states == {str(first.id): EDITOR_STATE, str(second.id): second_state}
        retained = await owner.save_draft(first.id, draft(1))
        assert retained["editorState"] == EDITOR_STATE
        cleared = await owner.save_draft(first.id, draft(2, editorState=None))
        assert cleared["editorState"] is None
        assert (await owner.get_draft(second.id))["editorState"] == second_state
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_editor_state_respects_conflicts_owner_scope_and_department_lock():
    session, _, budgets = await prepare()
    try:
        first, second = budgets
        owner = service(session, user())
        await owner.save_draft(first.id, draft(0, editorState=EDITOR_STATE))
        with pytest.raises(HTTPException) as stale:
            await owner.save_draft(first.id, draft(0, editorState=None))
        assert stale.value.status_code == 409
        with pytest.raises(HTTPException) as other_owner:
            await owner.save_draft(second.id, draft(0, editorState=EDITOR_STATE))
        assert other_owner.value.status_code == 404
        assert (await owner.get_draft(first.id))["editorState"] == EDITOR_STATE
        await owner.publish(first.id, PublishDTO(expected_revision=1))
        await submit(session, second)
        await act(session, "confirm")
        with pytest.raises(HTTPException) as locked:
            await owner.save_draft(first.id, draft(1, editorState=None))
        assert locked.value.status_code == 409
        assert (await owner.get_draft(first.id))["editorState"] == EDITOR_STATE
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_editor_state_not_exposed_as_unsubmitted_reserves_or_inherited_by_new_version():
    session, admin, budgets = await prepare()
    try:
        first = budgets[0]
        owner = service(session, user())
        await owner.save_draft(first.id, draft(0, editorState=EDITOR_STATE))
        for role in ("lead", "management"):
            reader = service(session, user(f"{role}@example.com", role))
            workspace = await reader.get_workspace(2027, version_id="202701")
            assert all(item["editorState"] is None for item in workspace["state"]["initiatives"])
            if role == "lead":
                assert (await reader.get_draft(first.id))["editorState"] is None
        publication = await owner.publish(first.id, PublishDTO(expected_revision=1))
        assert "editorState" not in publication["initiative"]
        await admin.create(PlanningVersionCreateDTO(
            id="202702", name="Next", planning_year=2027, source_version_id="202701",
        ))
        copies = list((await session.scalars(
            select(BudgetDO).where(BudgetDO.planning_version_id == "202702")
        )).all())
        assert copies and all(item.editor_state is None for item in copies)
        assert (await owner.get_draft(first.id))["editorState"] == EDITOR_STATE
    finally:
        await session.close()


@pytest.mark.parametrize("step", [0, 4, 1.5, "3", True])
def test_editor_state_rejects_invalid_steps(step):
    with pytest.raises(ValidationError):
        draft(0, editorState={"step": step})
