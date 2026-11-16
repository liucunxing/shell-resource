"""Editing a project must not perform one workflow query for every department peer."""

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.do.planning import InitiativeWorkflowDO, PlanningVersionDO
from app.schemas.dto.planning import VersionInitiativeDTO
from app.services.planning_service import PlanningService
from test_mutation_query_count import add_submitted_budgets, capture_queries
from test_planning_workflow import prepare, user


@pytest.mark.asyncio
async def test_edit_project_batches_peer_workflows_and_clears_every_confirmation():
    session, _, budgets = await prepare()
    engine = session.bind
    assert engine is not None
    try:
        async def measure():
            async with AsyncSession(engine, expire_on_commit=False) as fresh:
                version = await fresh.get(PlanningVersionDO, "202701")
                command = VersionInitiativeDTO(
                    expected_revision=version.revision, name="A", resourceType="MRD",
                    sector="PCMO", department="MKT", budget=100, ownerId="a@example.com",
                    reason="Synthetic edit",
                )
                with capture_queries(engine) as queries:
                    service = PlanningService(fresh, user("admin@example.com", "admin"))
                    await service.edit_initiative(
                        "202701", budgets[0].id, command,
                    )
                return [sql for sql in queries if sql.lstrip().upper().startswith("SELECT")]

        await add_submitted_budgets(session, 1)
        small = await measure()
        await add_submitted_budgets(session, 20)
        large = await measure()
        assert len(large) == len(small)
        assert sum("initiative_workflows" in sql for sql in large) <= 2
        async with AsyncSession(engine) as fresh:
            states = list(await fresh.scalars(select(InitiativeWorkflowDO)))
            assert len(states) == 23
            assert all(
                s.confirmed_publication_id is None and not s.owner_edit_locked for s in states
            )
            assert sum(s.publication_id is not None for s in states) == 21
    finally:
        await session.close()
        await engine.dispose()
