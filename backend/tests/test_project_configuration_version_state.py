"""Project configuration preserves the administrator's version lifecycle choice."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.repositories.workspace_repository import WorkspaceRepository
from app.schemas.dto.planning import (
    PlanningVersionUpdateDTO,
    VersionInitiativeDTO,
    VersionInitiativesImportDTO,
)
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO
from test_planning_workflow import act, prepare, service, submit, user


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["open", "stopped", "draft", "expired"])
@pytest.mark.parametrize("bulk", [False, True])
async def test_project_config_preserves_version_state_and_allocations(mode, bulk):
    session, admin, budgets = await prepare()
    try:
        budget = budgets[0]
        await submit(session, budget)
        version = await admin.version("202701")
        if mode in {"stopped", "draft"}:
            await admin.update(version.id, PlanningVersionUpdateDTO(
                expected_revision=version.revision, open=False,
                published=mode != "draft",
            ))
        elif mode == "expired":
            version.deadline = datetime.now(UTC) - timedelta(minutes=1)
            await session.commit()
        flags = (version.published, version.open)
        prior_revision = version.revision
        history = deepcopy(
            (await WorkspaceRepository(session).publications_for(budget.id))[0].snapshot,
        )
        command = dict(
            name=budget.initiative_name, resourceType=budget.resource_type,
            sector=budget.sector, department=budget.department,
            budget=120, ownerId=budget.owner_email, reason="调整预算",
        )
        if bulk:
            result = await admin.import_initiatives(version.id, VersionInitiativesImportDTO(
                expected_revision=prior_revision, preview=False,
                items=[{"id": budget.id, **command}],
            ))
        else:
            result = await admin.edit_initiative(version.id, budget.id, VersionInitiativeDTO(
                expected_revision=prior_revision, **command,
            ))
        assert (result["version"]["published"], result["version"]["open"]) == flags
        assert result["version"]["revision"] == prior_revision + 1
        rows = await WorkspaceRepository(session).rows_for(budget.id)
        assert rows[0].distributor_budget_amount == 100
        publication = (await WorkspaceRepository(session).publications_for(budget.id))[0]
        assert publication.snapshot == history
        state = await admin.state(budget.id)
        assert state.requires_resubmission and not state.confirmed_publication_id
        if mode in {"open", "expired"}:
            draft = await service(session, user(budget.owner_email)).get_draft(budget.id)
            assert draft["editable"]
        else:
            with pytest.raises(HTTPException) as blocked:
                await service(session, user(budget.owner_email)).save_draft(
                    budget.id, InitiativeDraftUpdateDTO(expected_revision=budget.revision),
                )
            assert blocked.value.status_code in {404, 409}
    finally:
        await session.close()


@pytest.mark.asyncio
async def test_version_name_and_deadline_edits_preserve_submissions_and_confirmation():
    session, admin, budgets = await prepare()
    try:
        for budget in budgets:
            await submit(session, budget)
        await act(session, "confirm")
        version = await admin.version("202701")
        workflows = [await admin.workflow(budget) for budget in budgets]
        revisions = [budget.revision for budget in budgets]
        snapshots = [
            deepcopy((await WorkspaceRepository(session).publications_for(b.id))[0].snapshot)
            for b in budgets
        ]
        await admin.update(version.id, PlanningVersionUpdateDTO(
            expected_revision=version.revision, name="延长版",
        ))
        assert version.name == "延长版" and version.open and version.published
        assert [budget.revision for budget in budgets] == revisions
        assert [await admin.workflow(budget) for budget in budgets] == workflows
        assert [(await WorkspaceRepository(session).publications_for(b.id))[0].snapshot
                for b in budgets] == snapshots
    finally:
        await session.close()
