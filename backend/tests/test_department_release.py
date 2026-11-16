"""Current department lifecycle: withdrawal unlocks; admin release resets the whole version."""
from copy import deepcopy
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from app.models.do.planning import PlanningVersionDO
from app.models.do.workspace import BudgetChangeLogDO
from app.repositories.workspace_repository import WorkspaceRepository
from app.schemas.dto.planning import (
    DepartmentActionDTO,
    PlanningVersionCreateDTO,
    PlanningVersionReleaseDTO,
    PlanningVersionUpdateDTO,
)
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO
from app.services.planning_service import PlanningService
from test_planning_workflow import act, prepare, service, submit, user


@pytest.mark.parametrize("deadline", [None, "2026-01-01T00:00:00Z", "2099-01-01T00:00:00"])
def test_release_requires_nonempty_future_timezone_aware_deadline(deadline):
    with pytest.raises(ValidationError):
        PlanningVersionReleaseDTO(expected_revision=1, deadline=deadline, reason="review")


@pytest.mark.asyncio
@pytest.mark.parametrize("barrier", ["closed", "expired"])
async def test_department_submission_and_withdrawal_blocked_after_barrier(barrier):
    session, admin, budgets = await prepare()
    try:
        for budget in budgets:
            await submit(session, budget)
        await act(session, "confirm")
        version = await admin.version("202701")
        if barrier == "closed":
            await admin.update(version.id, PlanningVersionUpdateDTO(
                expected_revision=version.revision, open=False,
            ))
        else:
            version.deadline = datetime.now(UTC) - timedelta(seconds=1)
            await session.commit()
        lead = PlanningService(session, user("lead@example.com", "lead"))
        before = await lead.department(version.id, "PCMO", "MKT")
        revision = version.revision
        assert not before["canConfirm"] and not before["canWithdraw"]
        for action in ("confirm", "withdraw"):
            with pytest.raises(HTTPException) as blocked:
                await act(session, action, reason="review")
            assert blocked.value.status_code == 409
            assert version.revision == revision
        assert (await lead.department(version.id, "PCMO", "MKT"))["confirmed"] == 2
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_close_requires_every_enabled_department_submitted():
    session, admin, budgets = await prepare()
    try:
        version = await admin.version("202701")
        # Owner submissions alone do not constitute department submissions.
        for budget in budgets:
            await submit(session, budget)
        revision = version.revision
        with pytest.raises(HTTPException) as missing:
            await admin.update(version.id, PlanningVersionUpdateDTO(
                expected_revision=revision, open=False,
            ))
        assert missing.value.status_code == 409 and version.open
        assert version.revision == revision
        await act(session, "confirm")
        result = await admin.update(version.id, PlanningVersionUpdateDTO(
            expected_revision=version.revision, open=False,
        ))
        assert not result["open"]
    finally:
        await session.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("other_status", ["unsubmitted", "dirty", "confirmed"])
async def test_release_all_departments_preserves_submissions_drafts_and_audit(other_status):
    session, admin, budgets = await prepare()
    try:
        # A confirmed MKT project plus each relevant workflow state in another department.
        budgets[1].department = "ICE"
        await session.commit()
        await submit(session, budgets[0])
        await act(session, "confirm")
        if other_status != "unsubmitted":
            await submit(session, budgets[1])
        if other_status == "dirty":
            await service(session, user(budgets[1].owner_email, department="ICE")).save_draft(
                budgets[1].id, InitiativeDraftUpdateDTO(expected_revision=budgets[1].revision,
                                                       rows=[{"dealerId": "d1", "amount": 40}]),
            )
        elif other_status == "confirmed":
            other_lead = PlanningService(session, user("ice-lead@example.com", "lead", "ICE"))
            current = await admin.version("202701")
            await other_lead.department_action(current.id, "confirm", DepartmentActionDTO(
                sector="PCMO", department="ICE", expected_revision=current.revision,
            ))
        other_history = [(row.id, deepcopy(row.snapshot)) for row in
                         await WorkspaceRepository(session).publications_for(budgets[1].id)]
        publication = (await WorkspaceRepository(session).publications_for(budgets[0].id))[0]
        snapshot = deepcopy(publication.snapshot)
        publication_id = publication.id
        version = await admin.version("202701")
        version.deadline = datetime.now(UTC) - timedelta(seconds=1)
        await session.commit()
        deadline = datetime.now(UTC) + timedelta(days=2)
        old_revision = version.revision
        result = await admin.release(version.id, PlanningVersionReleaseDTO(
            expected_revision=version.revision, reason="全版本重新复核", deadline=deadline,
        ))
        assert result["releasedInitiatives"] == 2
        assert result["version"]["open"] and not result["version"]["expired"]
        assert version.revision == old_revision + 1 and version.deadline == deadline
        for index, budget in enumerate(budgets):
            workflow = await PlanningService(
                session, user(budget.owner_email, department=budget.department)
            ).workflow(budget)
            assert workflow["editable"] and not workflow["confirmed"]
            assert workflow["submitted"] == (index == 0 or other_status == "confirmed")
            assert not workflow["ownerEditLocked"]
        history = await WorkspaceRepository(session).publications_for(budgets[0].id)
        assert len(history) == 1 and history[0].id == publication_id
        assert history[0].snapshot == snapshot
        assert [(row.id, row.snapshot) for row in
                await WorkspaceRepository(session).publications_for(budgets[1].id)] == other_history
        audit = await session.scalar(select(BudgetChangeLogDO).where(
            BudgetChangeLogDO.operation_type == "VERSION_RELEASE"
        ))
        assert audit.operator_id == "admin@example.com"
        assert audit.operation_note == "全版本重新复核"
        assert audit.before_data["deadline"] != audit.after_data["deadline"]
        # Editing a released submission invalidates only that owner's current submission.
        saved = await service(session, user()).save_draft(
            budgets[0].id, InitiativeDraftUpdateDTO(expected_revision=budgets[0].revision,
                                                  rows=[{"dealerId": "d1", "amount": 100}]),
        )
        assert not saved["workflow"]["submitted"]
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_release_reopens_closed_version_and_respects_permissions_and_revision(monkeypatch):
    session, admin, budgets = await prepare()
    try:
        for budget in budgets:
            await submit(session, budget)
        await act(session, "confirm")
        version = await admin.version("202701")
        await admin.update(version.id, PlanningVersionUpdateDTO(
            expected_revision=version.revision, open=False,
        ))
        deadline = datetime.now(UTC) + timedelta(hours=1)
        command = PlanningVersionReleaseDTO(
            expected_revision=version.revision, reason="review", deadline=deadline,
        )
        for identity in [user(), user("lead@example.com", "lead"),
                         replace(user("admin@example.com", "admin"),
                                 preview_actor_email="actor@example.com")]:
            with pytest.raises(HTTPException) as denied:
                await PlanningService(session, identity).release(version.id, command)
            assert denied.value.status_code == 403
        # Request can wait on a row lock: server must recheck time after parsing.
        with monkeypatch.context() as patch:
            patch.setattr("app.services.planning_service.utc_now", lambda: deadline)
            with pytest.raises(HTTPException) as elapsed:
                await admin.release(version.id, command)
            assert elapsed.value.status_code == 422
        assert not version.open
        await admin.release(version.id, command)
        assert version.open
        with pytest.raises(HTTPException) as stale:
            await admin.release(version.id, command)
        assert stale.value.status_code == 409
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_release_rechecks_deadline_after_loading_all_workflows(monkeypatch):
    session, admin, budgets = await prepare()
    try:
        for budget in budgets:
            await submit(session, budget)
        await act(session, "confirm")
        version = await admin.version("202701")
        revision = version.revision
        deadline = datetime.now(UTC) + timedelta(minutes=1)
        command = PlanningVersionReleaseDTO(
            expected_revision=revision, reason="review", deadline=deadline,
        )
        clock = [deadline - timedelta(seconds=1)]
        loaded = []
        states_for = admin.states_for

        async def delayed_workflows(loaded_budgets, *, create_missing=False):
            states = await states_for(loaded_budgets, create_missing=create_missing)
            loaded.extend(states.values())
            clock[0] = deadline
            return states

        monkeypatch.setattr("app.services.planning_service.utc_now", lambda: clock[0])
        monkeypatch.setattr(admin, "states_for", delayed_workflows)
        with pytest.raises(HTTPException) as elapsed:
            await admin.release(version.id, command)
        assert elapsed.value.status_code == 422
        assert len(loaded) == len(budgets)
        assert version.revision == revision and version.deadline is None
        assert all(state.confirmed_publication_id and state.owner_edit_locked for state in loaded)
        assert await session.scalar(select(BudgetChangeLogDO).where(
            BudgetChangeLogDO.operation_type == "VERSION_RELEASE"
        )) is None
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_admin_cannot_impersonate_department_submission_and_legacy_return_is_removed():
    session, admin, budgets = await prepare()
    try:
        for budget in budgets:
            await submit(session, budget)
        version = await admin.version("202701")
        payload = DepartmentActionDTO(sector="PCMO", department="MKT",
                                      expected_revision=version.revision, reason="review")
        for action in ("confirm", "withdraw"):
            with pytest.raises(HTTPException) as denied:
                await admin.department_action(version.id, action, payload)
            assert denied.value.status_code == 403
        with pytest.raises(HTTPException) as removed:
            await act(session, "return", reason="removed")
        assert removed.value.status_code == 422
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_release_cannot_bypass_another_open_versions_unsubmitted_departments():
    session, admin, _ = await prepare()
    try:
        await admin.create(PlanningVersionCreateDTO(
            id="202702", name="next", planning_year=2027, source_version_id="202701",
        ))
        version = await admin.version("202702")
        # A historical closed, published version created by an older application.
        version.published = True
        await session.commit()
        with pytest.raises(HTTPException) as unfinished:
            await admin.release(version.id, PlanningVersionReleaseDTO(
                expected_revision=version.revision, reason="review",
                deadline=datetime.now(UTC) + timedelta(days=1),
            ))
        assert unfinished.value.status_code == 409
        assert not version.open
        assert (await session.get(PlanningVersionDO, "202701")).open
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_publish_as_closed_cannot_skip_all_department_submission_guard():
    session, admin, _ = await prepare()
    try:
        version = await admin.version("202701")
        await admin.update(version.id, PlanningVersionUpdateDTO(
            expected_revision=version.revision, published=False, open=False,
        ))
        with pytest.raises(HTTPException) as bypass:
            await admin.update(version.id, PlanningVersionUpdateDTO(
                expected_revision=version.revision, published=True, open=False,
            ))
        assert bypass.value.status_code == 409
    finally:
        await session.close()
