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
@pytest.mark.parametrize("barrier", ["closed"])
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
@pytest.mark.parametrize("submitted", [False, True])
async def test_admin_can_stop_anytime_preserving_existing_work(submitted):
    session, admin, budgets = await prepare()
    try:
        if submitted:
            for budget in budgets:
                await submit(session, budget)
        history = [(p.id, deepcopy(p.snapshot)) for p in
                   await WorkspaceRepository(session).publications_for(budgets[0].id)]
        version = await admin.version("202701")
        result = await admin.update(version.id, PlanningVersionUpdateDTO(
            expected_revision=version.revision, open=False,
        ))
        assert result["published"] and not result["open"]
        assert [(p.id, p.snapshot) for p in
                await WorkspaceRepository(session).publications_for(budgets[0].id)] == history
        with pytest.raises(HTTPException) as stopped:
            await submit(session, budgets[0])
        assert stopped.value.status_code == 409
        await admin.update(version.id, PlanningVersionUpdateDTO(
            expected_revision=version.revision, open=True,
        ))
        assert version.open
        await submit(session, budgets[0])
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
        old_revision = version.revision
        result = await admin.release(version.id, PlanningVersionReleaseDTO(
            expected_revision=version.revision, reason="全版本重新复核",
        ))
        assert result["releasedInitiatives"] == 2
        assert result["version"]["open"] and "deadline" not in result["version"]
        assert version.revision == old_revision + 1 and version.deadline is not None
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
        assert "deadline" not in audit.after_data
        # Editing a released submission invalidates only that owner's current submission.
        saved = await service(session, user()).save_draft(
            budgets[0].id, InitiativeDraftUpdateDTO(expected_revision=budgets[0].revision,
                                                  rows=[{"dealerId": "d1", "amount": 100}]),
        )
        assert not saved["workflow"]["submitted"]
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_release_reopens_closed_version_and_respects_permissions_and_revision():
    session, admin, budgets = await prepare()
    try:
        for budget in budgets:
            await submit(session, budget)
        await act(session, "confirm")
        version = await admin.version("202701")
        await admin.update(version.id, PlanningVersionUpdateDTO(
            expected_revision=version.revision, open=False,
        ))
        command = PlanningVersionReleaseDTO(
            expected_revision=version.revision, reason="review",
        )
        for identity in [user(), user("lead@example.com", "lead"),
                         replace(user("admin@example.com", "admin"),
                                 preview_actor_email="actor@example.com")]:
            with pytest.raises(HTTPException) as denied:
                await PlanningService(session, identity).release(version.id, command)
            assert denied.value.status_code == 403
        assert not version.open
        await admin.release(version.id, command)
        assert version.open
        with pytest.raises(HTTPException) as stale:
            await admin.release(version.id, command)
        assert stale.value.status_code == 409
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
async def test_release_stops_other_open_version():
    session, admin, _ = await prepare()
    try:
        await admin.create(PlanningVersionCreateDTO(
            id="202702", name="next", planning_year=2027, source_version_id="202701",
        ))
        version = await admin.version("202702")
        # A historical closed, published version created by an older application.
        version.published = True
        await session.commit()
        await admin.release(version.id, PlanningVersionReleaseDTO(
            expected_revision=version.revision, reason="review",
        ))
        assert version.open
        assert not (await session.get(PlanningVersionDO, "202701")).open
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_published_stopped_version_does_not_require_department_submissions():
    session, admin, _ = await prepare()
    try:
        version = await admin.version("202701")
        await admin.update(version.id, PlanningVersionUpdateDTO(
            expected_revision=version.revision, open=False,
        ))
        result = await admin.update(version.id, PlanningVersionUpdateDTO(
            expected_revision=version.revision, published=True, open=False,
        ))
        assert result["published"] and not result["open"]
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_switch_is_global_preserves_confirmations_and_rejects_stale_or_invalid_open():
    session, admin, budgets = await prepare()
    try:
        for budget in budgets:
            await submit(session, budget)
        await act(session, "confirm")
        first = await admin.version("202701")
        first_revision = first.revision
        history = [(p.id, deepcopy(p.snapshot)) for p in
                   await WorkspaceRepository(session).publications_for(budgets[0].id)]
        await admin.create(PlanningVersionCreateDTO(
            id="202801", name="next year", planning_year=2028,
        ))
        await admin.update("202801", PlanningVersionUpdateDTO(
            expected_revision=0, published=True, open=True,
        ))
        assert first.published and not first.open and first.revision == first_revision + 1
        assert (await admin.workflow(budgets[0]))["confirmed"]
        assert [(p.id, p.snapshot) for p in
                await WorkspaceRepository(session).publications_for(budgets[0].id)] == history
        switched = await admin.version("202801")
        with pytest.raises(HTTPException) as stale:
            await admin.update(first.id, PlanningVersionUpdateDTO(
                expected_revision=first_revision, open=True,
            ))
        assert stale.value.status_code == 409 and switched.open
        await admin.update(first.id, PlanningVersionUpdateDTO(
            expected_revision=first.revision, open=True,
        ))
        assert first.open and not switched.open
        audits = list((await session.scalars(select(BudgetChangeLogDO).where(
            BudgetChangeLogDO.operation_type == "VERSION_DEACTIVATE"
        ))).all())
        assert len(audits) == 2
        assert all(a.before_data["open"] and not a.after_data["open"] for a in audits)
    finally:
        await session.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("activation", [{"published": True}, {"open": True}])
async def test_legacy_deadline_does_not_prevent_activation(activation):
    session, admin, _ = await prepare()
    try:
        await admin.create(PlanningVersionCreateDTO(
            id="202702", name="current", planning_year=2027, source_version_id="202701",
        ))
        await admin.update("202702", PlanningVersionUpdateDTO(
            expected_revision=0, published=True, open=True,
        ))
        legacy = await admin.version("202701")
        current = await admin.version("202702")
        # Preserve a pre-upgrade multi-open state with an expired historical window.
        legacy.open = True
        legacy.deadline = datetime.now(UTC) - timedelta(minutes=1)
        await session.commit()
        await admin.update(legacy.id, PlanningVersionUpdateDTO(
            expected_revision=legacy.revision, **activation,
        ))
        assert legacy.open and not current.open
    finally:
        await session.close()
