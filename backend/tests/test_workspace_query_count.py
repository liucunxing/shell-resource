"""Guard against per-initiative round trips on the login/refresh path."""

import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.do.budget import BudgetDO
from app.services.workspace_service import WorkspaceService
from test_planning_workflow import prepare, user


@pytest.mark.asyncio
@pytest.mark.parametrize("role", ["owner", "lead", "management", "admin"])
async def test_workspace_query_count_does_not_grow_with_visible_initiatives(role):
    session, _, _ = await prepare()
    engine = session.bind
    assert engine is not None
    identity = user("a@example.com", role)

    async def measure():
        queries = []

        def capture(_connection, _cursor, statement, _parameters, _context, _many):
            queries.append(statement)

        event.listen(engine.sync_engine, "before_cursor_execute", capture)
        try:
            # A fresh identity map matches a new HTTP request (no warmed ORM cache).
            async with AsyncSession(engine, expire_on_commit=False) as fresh:
                result = await WorkspaceService(fresh, identity).get_workspace(2027)
        finally:
            event.remove(engine.sync_engine, "before_cursor_execute", capture)
        return len(queries), result

    try:
        baseline_count, baseline = await measure()
        for number in range(20):
            session.add(BudgetDO(
                planning_year=2027, planning_version_id="202701",
                initiative_key=f"query-count-{number}", sector="PCMO", department="MKT",
                resource_type="R", initiative_name=f"Extra {number}",
                plan_budget_amount=100, allocate_budget_amount=0,
                owner_email="a@example.com", revision=0, status=0,
                input_source="TEST", enabled=True,
            ))
        await session.commit()
        expanded_count, expanded = await measure()
        assert len(expanded["state"]["initiatives"]) == len(baseline["state"]["initiatives"]) + 20
        assert expanded_count == baseline_count
        assert expanded_count < 20
    finally:
        await session.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_allocation_directory_keeps_identity_without_loading_financial_history():
    from app.core.dealer_identity import dealer_identity
    from app.repositories.reference_repository import ReferenceRepository
    from test_workspace import _session

    session = await _session()
    engine = session.bind
    try:
        repository = ReferenceRepository(session)
        full = await repository.list_dealers(sectors=("PCMO",))
        directory = await repository.list_directory(sectors=("PCMO",))
        assert [dealer_identity(row) for row in directory] == [dealer_identity(row) for row in full]
        assert set(directory[0]) == {
            "distributor_code", "distributor_name", "sector", "sd", "rsm", "distributor_status",
        }
        assert await repository.list_directory(sectors=()) == []
    finally:
        await session.close()
        if engine is not None:
            await engine.dispose()
