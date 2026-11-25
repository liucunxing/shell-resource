from copy import deepcopy
from dataclasses import replace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.models.do.budget import BudgetDO
from app.models.do.planning import PlanningVersionDO
from app.models.do.workspace import BudgetChangeLogDO, WorkspacePublicationDO
from app.schemas.dto.planning import PlanningVersionClearDraftsDTO, PlanningVersionCreateDTO
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO, PublishDTO
from app.services.planning_service import PlanningService
from test_planning_workflow import act, prepare, service, submit, user


@pytest.mark.asyncio
async def test_clear_only_this_version_and_start_a_new_submission_cycle():
    session, admin, budgets = await prepare()
    engine = session.bind
    try:
        first, second = budgets
        owner = service(session, user(first.owner_email))
        assert not (await owner.get_draft(first.id))["workflow"]["hasSavedDraft"]
        zero = await owner.save_draft(first.id, InitiativeDraftUpdateDTO(
            expected_revision=first.revision, rows=[{"dealerId": "d1", "amount": 0}],
        ))
        assert zero["workflow"]["hasSavedDraft"]
        workspace = await owner.get_workspace(2027, version_id="202701")
        assert workspace["state"]["initiatives"][0]["workflow"]["hasSavedDraft"]
        await owner.save_draft(first.id, InitiativeDraftUpdateDTO(
            expected_revision=first.revision, rows=[{"dealerId": "d1", "amount": 50}],
            otherBudgets=[{"id": "reserve", "reasonId": "misc", "amount": 50, "note": "reserve"}],
            editorState={"step": 3, "reserveAcknowledgement": "old"},
            changeReason="old",
        ))
        await owner.publish(first.id, PublishDTO(expected_revision=first.revision))
        await submit(session, second)
        await act(session, "confirm")
        version = await session.get(PlanningVersionDO, "202701")
        publication = (await admin.repository.publications_for(first.id))[0]
        previous_snapshot = deepcopy(publication.snapshot)
        # Include a disabled Initiative in the clear and keep a separate version as a control.
        second.enabled = False
        await session.commit()
        await admin.create(PlanningVersionCreateDTO(
            id="202702", name="copy before reset", planning_year=2027, source_version_id=version.id,
        ))
        config = (first.initiative_name, first.owner_email, first.plan_budget_amount, first.sector)
        previous_revision = version.revision
        command = PlanningVersionClearDraftsDTO(expected_revision=previous_revision, confirmed=True)
        result = await admin.clear_drafts("202701", command)
        assert result["clearedInitiatives"] == 2
        assert result["version"]["id"] == version.id
        assert result["version"]["revision"] == previous_revision + 1
        assert version.open and version.published
        assert config == (first.initiative_name, first.owner_email, first.plan_budget_amount,
                          first.sector)
        assert not second.enabled
        assert first.allocate_budget_amount == second.allocate_budget_amount == 0
        assert first.status == second.status == 0
        assert first.editor_state is None
        draft = await owner.get_draft(first.id)
        assert draft["workflow"]["draftResetRevision"] == first.revision
        assert not draft["workflow"]["hasSavedDraft"]
        assert draft["rows"] == draft["otherBudgets"] == []
        assert draft["workflow"]["editable"] and not draft["workflow"]["submitted"]
        assert not draft["workflow"]["confirmed"] and not draft["workflow"]["changeReason"]
        assert draft["publishedRevision"] is None
        assert await owner.publications(first.id) == []
        assert await admin.repository.latest_submissions_for([b.id for b in budgets]) == {}
        assert (await admin.department("202701", "PCMO", "MKT"))["confirmed"] == 0
        workspace = await owner.get_workspace(2027, version_id="202701")
        assert workspace["state"]["publications"] == {}
        workflow = workspace["state"]["initiatives"][0]["workflow"]
        assert workflow["draftResetRevision"] == first.revision
        assert not workflow["hasSavedDraft"]
        summary = await owner.get_workspace(2027, version_id="202701", comparison_summary=True)
        assert not summary["initiatives"][0]["allocationVisible"]
        assert summary["initiatives"][0]["allocationTotal"] == 0
        with pytest.raises(HTTPException) as conflict:
            await admin.clear_drafts("202701", command)
        assert conflict.value.status_code == 409
        with pytest.raises(HTTPException) as stale:
            await owner.save_draft(first.id, InitiativeDraftUpdateDTO(
                expected_revision=first.revision - 1, rows=[{"dealerId": "d1", "amount": 100}],
            ))
        assert stale.value.status_code == 409
        await admin.create(PlanningVersionCreateDTO(
            id="202703", name="copy after reset", planning_year=2027, source_version_id=version.id,
        ))
        for destination, expected in [("202702", 50), ("202703", 0)]:
            copied = await session.scalar(select(BudgetDO).where(
                BudgetDO.planning_version_id == destination,
                BudgetDO.owner_email == first.owner_email,
            ))
            assert sum(r.distributor_budget_amount for r in await admin.repository.rows_for(
                copied.id)) == expected
        assert (await submit(session, first))["number"] == 2
        assert (await owner.get_draft(first.id))["workflow"]["hasSavedDraft"]
        assert len(await owner.publications(first.id)) == 1
        historical = await session.get(WorkspacePublicationDO, publication.id)
        assert historical.snapshot == previous_snapshot
        log = await session.scalar(select(BudgetChangeLogDO).where(
            BudgetChangeLogDO.operation_type == "VERSION_CLEAR_DRAFTS"))
        assert log.operator_id == admin.user.email and log.after_data == result
    finally:
        await session.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_confirmation_revision_and_real_admin_are_required():
    session, admin, budgets = await prepare()
    engine = session.bind
    try:
        await submit(session, budgets[0])
        version = await session.get(PlanningVersionDO, "202701")
        command = PlanningVersionClearDraftsDTO(expected_revision=version.revision, confirmed=True)
        for actor in [user(), replace(admin.user, preview_actor_email="preview@example.com")]:
            with pytest.raises(HTTPException) as denied:
                await PlanningService(session, actor).clear_drafts(version.id, command)
            assert denied.value.status_code == 403
        with pytest.raises(HTTPException) as confirmation:
            await admin.clear_drafts(version.id, command.model_copy(update={"confirmed": False}))
        assert confirmation.value.status_code == 422
        with pytest.raises(ValidationError):
            PlanningVersionClearDraftsDTO(expected_revision=version.revision)
        with pytest.raises(HTTPException) as stale:
            await admin.clear_drafts(
                version.id, command.model_copy(update={"expected_revision": 0}),
            )
        assert stale.value.status_code == 409
        assert budgets[0].allocate_budget_amount == 100
        assert len(await admin.repository.publications_for(budgets[0].id)) == 1
    finally:
        await session.close()
        await engine.dispose()
