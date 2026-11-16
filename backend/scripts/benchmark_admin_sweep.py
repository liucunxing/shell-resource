"""Reuse the isolated rollback-only fixture to measure newly audited admin paths.

Same explicit APP_SETTINGS_FILE/development and PERF_SOURCE_ROOT options as
benchmark_mutations.py. No model calls, source data reads, or business writes.
"""

import argparse
import asyncio
import json
import os
from pathlib import Path
from uuid import uuid4

from benchmark_mutations import actor, measure, seed, session_for
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.models.do import (
    BaseDO,
    BudgetDO,
    UserPermissionDO,
    WorkspacePublicationDO,
)
from app.repositories.admin_repository import AdminRepository
from app.schemas.dto.planning import VersionInitiativeDTO
from app.schemas.dto.workbench import AdminUserDTO, AdminUsersImportDTO
from app.services.admin_service import AdminService
from app.services.planning_service import PlanningService


async def operations(connection, results):
    budget_id, _ = await seed(connection, 23, 300)
    async with session_for(connection) as session:
        budgets = list(await session.scalars(select(BudgetDO).order_by(BudgetDO.id)))
        for index, budget in enumerate(budgets):
            budget.owner_email = f"synthetic-{index}@example.test"
        for publication in await session.scalars(select(WorkspacePublicationDO)):
            snapshot = publication.snapshot
            publication.snapshot = {**snapshot, "initiative": {
                **snapshot["initiative"], "otherBudgets": [
                    {"reasonId": "archive-only", "amount": 0},
                ],
            }}
        await session.commit()
        users = list(await session.scalars(select(UserPermissionDO)))
        fields = AdminUserDTO.model_fields
        items = [AdminUserDTO(**{key: getattr(user, key) for key in fields}) for user in users
                 if user.email.startswith("synthetic-")][:23]
        revision = await AdminService(session, actor("admin")).users_revision()
    imported = await measure(connection, results, "import_23_assigned_users", lambda s:
        AdminService(s, actor("admin")).import_users(AdminUsersImportDTO(
            expected_revision=revision, items=items, preview=False)))
    assert imported["total"] == 23
    reasons = await measure(connection, results, "historical_reason_usage", lambda s:
        AdminRepository(s).used_reason_ids())
    assert "archive-only" in reasons
    await measure(connection, results, "edit_project_with_23_department_peers", lambda s:
        PlanningService(s, actor("admin")).edit_initiative("202701", budget_id,
            VersionInitiativeDTO(
                expected_revision=0, name="Synthetic edited", resourceType="MRD",
                sector="PCMO", department="MKT", budget=300,
                ownerId="synthetic-0@example.test", reason="Synthetic performance check",
            )))


async def run(report_path):
    report = {"status": "running", "business_writes": False, "synthetic_data": True,
              "measurements": [], "cleanup": "not_created"}
    engine = None
    schema = "codex_perf_" + uuid4().hex
    try:
        if not os.environ.get("APP_SETTINGS_FILE"):
            raise ValueError("Explicit settings required")
        settings = get_settings()
        url = settings.database_url.get_secret_value()
        if settings.app_env != "development" or not url.startswith("postgresql+asyncpg://"):
            raise ValueError("Development PostgreSQL required")
        engine = create_async_engine(url, hide_parameters=True, connect_args={
            "timeout": 15, "server_settings": {
                "statement_timeout": "20000", "lock_timeout": "3000",
            },
        })
        async with engine.connect() as raw:
            connection = await raw.execution_options(schema_translate_map={"data": schema})
            transaction = await connection.begin()
            try:
                await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
                report["cleanup"] = "pending_rollback"
                await connection.run_sync(BaseDO.metadata.create_all)
                await operations(connection, report["measurements"])
                assert transaction.is_active
            finally:
                await transaction.rollback()
                remaining = await connection.scalar(text(
                    "SELECT count(*) FROM pg_namespace WHERE nspname=:schema"), {"schema": schema})
                await connection.rollback()
                report["cleanup"] = "rolled_back_schema_absent" if remaining == 0 else "FAILED"
                assert remaining == 0
        report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error_type"] = type(error).__name__
    finally:
        if engine is not None:
            await engine.dispose()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True, type=Path)
    arguments = parser.parse_args()
    raise SystemExit(asyncio.run(run(arguments.report)))
