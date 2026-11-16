"""Admin batch validation must not issue queries for every imported row."""

import pytest
from sqlalchemy import select

from app.models.do.budget import BudgetDO
from app.models.do.workspace import BudgetChangeLogDO, UserPermissionDO, WorkspacePublicationDO
from app.repositories.admin_repository import AdminRepository
from app.schemas.dto.workbench import AdminUsersImportDTO
from test_admin_imports_colors import person, users_setup
from test_mutation_query_count import capture_queries
from test_workspace import _session


@pytest.mark.asyncio
async def test_user_import_batches_assigned_budget_checks_and_keeps_audit_ids():
    session, service = await users_setup()
    engine = session.bind
    assert engine is not None
    try:
        items = [person(f"bulk-{index}@example.test") for index in range(23)]
        for item in items:
            session.add(UserPermissionDO(**item))
            session.add(BudgetDO(
                planning_year=2027, sector="PCMO", department="MKT", resource_type="MRD",
                initiative_name=item["email"], plan_budget_amount=100, allocate_budget_amount=0,
                owner_email=item["email"], revision=0, status=0, input_source="TEST",
            ))
        await session.commit()
        counts = []
        for count in (1, 23):
            payload = AdminUsersImportDTO(
                expected_revision=await service.users_revision(), items=items[:count],
                preview=False,
            )
            with capture_queries(engine) as queries:
                result = await service.import_users(payload)
            counts.append(sum(sql.startswith("SELECT") for sql in queries))
            assert result["revision"] == await service.users_revision()
        assert counts == [3, 3]
        # New user IDs must still be generated before serializing their audit records.
        await service.import_users(AdminUsersImportDTO(
            expected_revision=await service.users_revision(), preview=False,
            items=[person("created-1@example.test"), person("created-2@example.test")],
        ))
        records = list(await session.scalars(select(BudgetChangeLogDO).where(
            BudgetChangeLogDO.operation_type == "USER_IMPORT",
        )))
        assert len(records) == 26
        assert all(record.after_data["id"] is not None for record in records)
    finally:
        await session.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_user_import_preserves_legacy_email_normalization():
    session, service = await users_setup()
    engine = session.bind
    assert engine is not None
    try:
        legacy = UserPermissionDO(**person(" legacy@example.test "))
        session.add(legacy)
        session.add(BudgetDO(
            planning_year=2027, sector="PCMO", department="MKT", resource_type="MRD",
            initiative_name="Legacy", plan_budget_amount=100, allocate_budget_amount=0,
            owner_email="legacy@example.test", revision=0, status=0, input_source="TEST",
        ))
        await session.commit()
        result = await service.import_users(AdminUsersImportDTO(
            expected_revision=await service.users_revision(), preview=False,
            items=[person("legacy@example.test")],
        ))
        assert result["created"] == 0 and result["updated"] == 1
        assert legacy.email == "legacy@example.test"
        assert result["revision"] == await service.users_revision()
    finally:
        await session.close()
        await engine.dispose()


@pytest.mark.asyncio
async def test_used_reasons_project_only_reserves_with_legacy_fallback():
    session = await _session()
    engine = session.bind
    assert engine is not None
    try:
        snapshots = [
            {"initiative": {"rows": [{"note": "large allocation" * 5000}],
                            "otherBudgets": [{"reasonId": "nested"}]}},
            {"otherBudgets": [{"reasonId": "legacy"}]},
            {"initiative": {}, "otherBudgets": [{"reasonId": "ignored"}]},
        ]
        session.add_all([WorkspacePublicationDO(
            budget_id=1, department="MKT", publication_number=index + 1,
            published_revision=0, snapshot=snapshot,
        ) for index, snapshot in enumerate(snapshots)])
        await session.commit()
        with capture_queries(engine) as queries:
            used = await AdminRepository(session).used_reason_ids()
        assert used == {"nested", "legacy"}
        assert len(queries) == 2
        assert "JSON_EXTRACT" in queries[1]
        assert not queries[1].startswith("SELECT data.workspace_publications.snapshot")
    finally:
        await session.close()
        await engine.dispose()
