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
TRIAL_STATE = {
    "metric": "investment",
    "period": "2026Ytd",
    "baselineRows": [{"dealerId": "d1", "amount": "24.50", "note": "Original allocation"}],
    "allocationFingerprint": "current-allocation-fingerprint",
}


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
async def test_trial_state_roundtrip_omission_and_clear_keep_other_initiative_independent():
    session, _, budgets = await prepare()
    try:
        first, second = budgets
        second.owner_email = first.owner_email
        await session.commit()
        owner = service(session, user())
        first_state = {**EDITOR_STATE, "trial": TRIAL_STATE}
        second_state = {
            **EDITOR_STATE,
            "trial": {**TRIAL_STATE, "metric": "c3", "period": "2025"},
        }
        await owner.save_draft(first.id, draft(0, editorState=first_state))
        await owner.save_draft(second.id, draft(0, editorState=second_state))
        first_id, second_id = first.id, second.id
        session.expire_all()
        assert (await owner.get_draft(first_id))["editorState"] == first_state
        assert (await owner.get_draft(second_id))["editorState"] == second_state
        retained = await owner.save_draft(first.id, draft(1))
        assert retained["editorState"] == first_state
        cleared = await owner.save_draft(
            first.id, draft(2, editorState={**EDITOR_STATE, "trial": None}),
        )
        assert cleared["editorState"] == {**EDITOR_STATE, "trial": None}
        assert (await owner.get_draft(second.id))["editorState"] == second_state
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_legacy_partial_editor_state_still_receives_original_defaults():
    session, _, budgets = await prepare()
    try:
        saved = await service(session, user()).save_draft(budgets[0].id, draft(0, editorState={}))
        assert saved["editorState"] == {"step": 1, "reserveAcknowledgement": ""}
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_editor_state_respects_conflicts_owner_scope_and_department_lock():
    session, _, budgets = await prepare()
    try:
        first, second = budgets
        owner = service(session, user())
        saved_state = {**EDITOR_STATE, "trial": TRIAL_STATE}
        await owner.save_draft(first.id, draft(0, editorState=saved_state))
        with pytest.raises(HTTPException) as stale:
            await owner.save_draft(first.id, draft(0, editorState=None))
        assert stale.value.status_code == 409
        with pytest.raises(HTTPException) as other_owner:
            await owner.save_draft(second.id, draft(0, editorState=EDITOR_STATE))
        assert other_owner.value.status_code == 404
        assert (await owner.get_draft(first.id))["editorState"] == saved_state
        await owner.publish(first.id, PublishDTO(expected_revision=1))
        await submit(session, second)
        await act(session, "confirm")
        with pytest.raises(HTTPException) as locked:
            await owner.save_draft(first.id, draft(1, editorState=None))
        assert locked.value.status_code == 409
        assert (await owner.get_draft(first.id))["editorState"] == saved_state
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_editor_state_not_exposed_as_unsubmitted_reserves_or_inherited_by_new_version():
    session, admin, budgets = await prepare()
    try:
        first = budgets[0]
        owner = service(session, user())
        saved_state = {**EDITOR_STATE, "trial": TRIAL_STATE}
        await owner.save_draft(first.id, draft(0, editorState=saved_state))
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
        assert (await owner.get_draft(first.id))["editorState"] == saved_state
    finally:
        await session.close()


@pytest.mark.parametrize("step", [0, 4, 1.5, "3", True])
def test_editor_state_rejects_invalid_steps(step):
    with pytest.raises(ValidationError):
        draft(0, editorState={"step": step})


@pytest.mark.parametrize("trial_patch", [
    {"metric": "unknown"},
    {"period": "2024"},
    {"baselineRows": [{"dealerId": " ", "amount": 1}]},
    {"baselineRows": [{"dealerId": "d1", "amount": -1}]},
    {"baselineRows": [{"dealerId": "d1", "amount": "1.001"}]},
    {"baselineRows": [{"dealerId": "d1", "amount": "NaN"}]},
    {"allocationFingerprint": "x" * 1048577},
])
def test_trial_state_rejects_invalid_scheme_period_baseline_and_fingerprint(trial_patch):
    with pytest.raises(ValidationError):
        draft(0, editorState={**EDITOR_STATE, "trial": {**TRIAL_STATE, **trial_patch}})
