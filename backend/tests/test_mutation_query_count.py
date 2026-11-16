"""Round-trip regressions for common writes and department status reads."""

from contextlib import contextmanager

import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.do.budget import BudgetDO
from app.models.do.distributor_history import distributor_sellin_resource_history
from app.models.do.planning import InitiativeWorkflowDO
from app.models.do.workspace import WorkspacePublicationDO
from app.repositories.workspace_repository import WorkspaceRepository
from app.schemas.dto.planning import PlanningVersionCreateDTO
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO, PublishDTO
from app.services.planning_service import PlanningService
from app.services.workspace_service import WorkspaceService
from test_planning_workflow import prepare, user


@contextmanager
def capture_queries(engine):
    queries = []

    def capture(_connection, _cursor, statement, _parameters, _context, _many):
        queries.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", capture)
    try:
        yield queries
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", capture)


async def add_submitted_budgets(session, count):
    budgets = [BudgetDO(
        planning_year=2027, planning_version_id="202701", initiative_key=f"perf-{index}",
        sector="PCMO", department="MKT", resource_type="R", initiative_name=f"Extra {index}",
        plan_budget_amount=100, allocate_budget_amount=25, owner_email="a@example.com",
        revision=2, status=0, input_source="TEST", enabled=True,
    ) for index in range(count)]
    session.add_all(budgets)
    await session.flush()
    for budget in budgets:
        for number in (1, 2):
            snapshot = WorkspaceService._budget_projection(budget, [], [])
            snapshot["rows"] = [{"dealerId": "d1", "amount": number * 50, "note": None}]
            publication = WorkspacePublicationDO(
                budget_id=budget.id, department="MKT", publication_number=number,
                published_revision=number, snapshot={"initiative": snapshot},
            )
            session.add(publication)
            await session.flush()
        session.add(InitiativeWorkflowDO(
            budget_id=budget.id, publication_id=publication.id,
            confirmed_publication_id=publication.id, requires_resubmission=False,
        ))
    await session.commit()
    return budgets


@pytest.mark.asyncio
async def test_department_status_reads_current_submissions_in_constant_queries():
    session, _, _ = await prepare()
    engine = session.bind
    assert engine is not None

    async def measure():
        with capture_queries(engine) as queries:
            async with AsyncSession(engine, expire_on_commit=False) as fresh:
                result = await PlanningService(fresh, user("lead@example.com", "lead")).department(
                    "202701", "PCMO", "MKT",
                )
        return queries, result

    try:
        await add_submitted_budgets(session, 1)
        baseline_queries, baseline = await measure()
        await add_submitted_budgets(session, 20)
        queries, result = await measure()
        assert len(queries) == len(baseline_queries) == 4
        assert result["total"] == baseline["total"] + 20
        assert result["submitted"] == result["confirmed"] == 21
        assert all(item["rows"][0]["amount"] == 100 for item in result["items"] if item["rows"])
        assert len([sql for sql in queries if "workspace_publications" in sql]) == 1
    finally:
        await session.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_create_version_batches_children_and_only_reads_latest_submission():
    session, _, _ = await prepare()
    engine = session.bind
    assert engine is not None

    async def measure(version_id):
        with capture_queries(engine) as queries:
            async with AsyncSession(engine, expire_on_commit=False) as fresh:
                await PlanningService(fresh, user("admin@example.com", "admin")).create(
                    PlanningVersionCreateDTO(
                        id=version_id, name=version_id, planning_year=2027,
                        source_version_id="202701",
                    ),
                )
        return queries

    try:
        await add_submitted_budgets(session, 1)
        baseline = await measure("202702")
        await add_submitted_budgets(session, 20)
        queries = await measure("202703")
        assert sum(sql.startswith("SELECT") for sql in queries) == sum(
            sql.startswith("SELECT") for sql in baseline
        )
        assert sum(sql.startswith("INSERT INTO data.budgets_distributor") for sql in queries) == 1
        assert sum(sql.startswith("INSERT INTO data.initiative_workflows") for sql in queries) == 1
        assert not any(sql.startswith("DELETE") for sql in queries)
        copies = list(await session.scalars(select(BudgetDO).where(
            BudgetDO.planning_version_id == "202703",
        )))
        copied_rows, _, copied_publications = await WorkspaceRepository(session).projection_rows(
            [budget.id for budget in copies],
        )
        assert len(copies) == 23 and len(copied_rows) == 21
        assert all(rows[0].distributor_budget_amount == 100 for rows in copied_rows.values())
        assert not copied_publications
        for budget in copies:
            assert budget.revision == 0 and budget.status == 0
    finally:
        await session.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_save_300_dealers_uses_one_insert_and_publish_does_not_fetch_old_snapshots():
    session, _, budgets = await prepare()
    engine = session.bind
    assert engine is not None
    budget_id = budgets[0].id
    try:
        await session.execute(distributor_sellin_resource_history.insert(), [
            {"distributor_code": f"bulk-{index}", "distributor_name": f"Dealer {index}",
             "sector": "PCMO", "distributor_status": "1"} for index in range(300)
        ])
        await session.commit()
        with capture_queries(engine) as queries:
            async with AsyncSession(engine, expire_on_commit=False) as fresh:
                result = await WorkspaceService(fresh, user()).save_draft(
                    budget_id, InitiativeDraftUpdateDTO(expected_revision=0, rows=[
                        {"dealerId": f"bulk-{index}", "amount": 100 if index == 0 else 0}
                        for index in range(300)
                    ]),
                )
        assert len(result["rows"]) == 300 and result["revision"] == 1
        assert sum(sql.startswith("INSERT INTO data.budgets_distributor") for sql in queries) == 1
        async with AsyncSession(engine, expire_on_commit=False) as fresh:
            await WorkspaceService(fresh, user()).publish(
                budget_id, PublishDTO(expected_revision=1),
            )
        with capture_queries(engine) as queries:
            async with AsyncSession(engine, expire_on_commit=False) as fresh:
                published = await WorkspaceService(fresh, user()).publish(
                    budget_id, PublishDTO(expected_revision=1),
                )
        assert published["number"] == 2 and len(published["initiative"]["rows"]) == 300
        snapshot_reads = [sql for sql in queries if sql.startswith("SELECT")
                          and "workspace_publications.snapshot" in sql]
        assert not snapshot_reads
    finally:
        await session.close()
        await engine.dispose()
