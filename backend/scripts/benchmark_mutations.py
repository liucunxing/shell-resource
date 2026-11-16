"""Measure synthetic mutations in an isolated PostgreSQL schema, then roll it all back.

Requires explicit APP_SETTINGS_FILE and the development profile. Never reads business
rows. PERF_SOURCE_ROOT can select a separately extracted baseline src directory.
Timings cover service/database work, excluding browser, gateway and authentication.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from time import perf_counter
from typing import Any
from uuid import uuid4

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, os.environ.get("PERF_SOURCE_ROOT", str(BACKEND_ROOT / "src")))

from sqlalchemy import event, insert, select, text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, create_async_engine  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.dealer_identity import dealer_identity  # noqa: E402
from app.dependencies.workbench_user import WorkbenchUser  # noqa: E402
from app.models.do import (  # noqa: E402
    BaseDO,
    BudgetDistributorDO,
    BudgetDO,
    InitiativeWorkflowDO,
    PlanningVersionDO,
    UserPermissionDO,
    WorkspaceConfigDO,
    WorkspacePublicationDO,
    distributor_sellin_resource_history,
)
from app.schemas.dto.planning import (  # noqa: E402
    PlanningVersionCreateDTO,
    PlanningVersionDeleteDTO,
)
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO, PublishDTO  # noqa: E402
from app.services.admin_service import AdminService  # noqa: E402
from app.services.planning_service import PlanningService  # noqa: E402
from app.services.workspace_service import WorkspaceService  # noqa: E402


def session_for(connection: AsyncConnection) -> AsyncSession:
    return AsyncSession(
        connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )


def actor(role: str) -> WorkbenchUser:
    return WorkbenchUser(
        f"{role}@example.test", role, "MKT", "Synthetic", ("PCMO",),
        affiliation_sector="PCMO", affiliation_department="MKT",
    )


async def seed(connection: AsyncConnection, projects: int, dealers: int) -> tuple[int, list[dict]]:
    directory = [
        {"distributor_code": f"SYNTHETIC-{i}", "distributor_name": f"Synthetic {i}",
         "sector": "PCMO", "sd": "Synthetic SD", "rsm": "Synthetic RSM",
         "distributor_status": "1"}
        for i in range(dealers)
    ]
    payload_rows = [{"dealerId": dealer_identity(row), "amount": 1} for row in directory]
    async with session_for(connection) as session:
        session.add(WorkspaceConfigDO(id=1, revision=0))
        session.add_all([UserPermissionDO(
            email=f"{role}@example.test", display_name=f"Synthetic {role}", role=role,
            department=["MKT"], sector=["PCMO"], enabled=True,
            affiliation_sector="PCMO", affiliation_department="MKT",
        ) for role in ["owner", "lead", "admin", "management"]])
        session.add_all([UserPermissionDO(
            email=f"synthetic-{i}@example.test", display_name=f"Synthetic {i}", role="owner",
            department=["MKT"], sector=["PCMO"], enabled=True,
            affiliation_sector="PCMO", affiliation_department="MKT",
        ) for i in range(26)])
        session.add(PlanningVersionDO(
            id="202701", name="Synthetic baseline", planning_year=2027,
            published=True, open=True, revision=0, created_by="admin@example.test",
        ))
        await session.execute(distributor_sellin_resource_history.insert(), directory)
        budgets = [BudgetDO(
            planning_year=2027, planning_version_id="202701", initiative_key=f"synthetic-{i}",
            sector="PCMO", department="MKT", resource_type="MRD",
            initiative_name=f"Synthetic {i}", plan_budget_amount=dealers,
            allocate_budget_amount=dealers, owner_email="owner@example.test",
            revision=1, status=1, input_source="SYNTHETIC_BENCHMARK", enabled=True,
        ) for i in range(projects)]
        session.add_all(budgets)
        await session.flush()
        allocation_values = []
        for budget in budgets:
            rows = [BudgetDistributorDO(
                budget_id=budget.id, planning_year=2027, sector="PCMO", department="MKT",
                resource_type="MRD", initiative_name=budget.initiative_name,
                distributor_code=source["distributor_code"], history_key=dealer_identity(source),
                sd=source["sd"], rsm=source["rsm"], distributor_budget_amount=1,
                input_source="DRAFT",
            ) for source in directory]
            allocation_values.extend({
                column.name: getattr(row, column.name)
                for column in BudgetDistributorDO.__table__.columns
                if column.name not in {"id", "created_at", "updated_at"}
            } for row in rows)
            publication = WorkspacePublicationDO(
                budget_id=budget.id, department="MKT", publication_number=1,
                published_revision=1,
                snapshot={"initiative": WorkspaceService._budget_projection(budget, rows, [])},
            )
            session.add(publication)
            await session.flush()
            session.add(InitiativeWorkflowDO(
                budget_id=budget.id, publication_id=publication.id,
                requires_resubmission=False, change_reason="Synthetic benchmark",
            ))
        await session.execute(insert(BudgetDistributorDO), allocation_values)
        await session.commit()
        return budgets[0].id, payload_rows


async def measure(connection: AsyncConnection, measurements: list[dict], name: str, operation: Any):
    count = 0

    def capture(*_args: Any) -> None:
        nonlocal count
        count += 1

    event.listen(connection.sync_connection, "before_cursor_execute", capture)
    start = perf_counter()
    try:
        async with session_for(connection) as session:
            result = await operation(session)
    finally:
        elapsed = perf_counter() - start
        event.remove(connection.sync_connection, "before_cursor_execute", capture)
        measurements.append({"operation": name, "seconds": round(elapsed, 3), "sql": count})
    return result


async def run(report_path: Path, projects: int, dealers: int, label: str) -> int:
    schema = "codex_perf_" + uuid4().hex
    report: dict[str, Any] = {
        "status": "running", "label": label, "projects": projects, "dealers_per_project": dealers,
        "synthetic_data": True, "business_writes": False, "cleanup": "not_created",
        "timing_scope": "service_and_database_excludes_browser_gateway_authentication",
        "measurements": [],
    }
    engine = None
    try:
        if not os.environ.get("APP_SETTINGS_FILE"):
            raise ValueError("explicit_settings_file_required")
        settings = get_settings()
        if settings.app_env != "development":
            raise ValueError("development_profile_required")
        if not settings.database_url.get_secret_value().startswith("postgresql+asyncpg://"):
            raise ValueError("postgresql_required")
        engine = create_async_engine(
            settings.database_url.get_secret_value(), echo=False, hide_parameters=True,
            connect_args={"timeout": 15, "server_settings": {
                "statement_timeout": "20000", "lock_timeout": "3000",
            }},
        )
        async with engine.connect() as raw:
            connection = await raw.execution_options(schema_translate_map={"data": schema})
            transaction = await connection.begin()
            try:
                await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
                report["cleanup"] = "pending_rollback"
                await connection.run_sync(BaseDO.metadata.create_all)
                budget_id, rows = await seed(connection, projects, dealers)
                results = report["measurements"]
                people = await measure(connection, results, "list_30_users", lambda s:
                    AdminService(s, actor("admin")).list_users(
                        email=None, name=None, role=None, department=None, sector=None,
                        limit=20, offset=0))
                assert people["total"] == 30 and len(people["items"]) == 20
                department = await measure(connection, results, "department_status", lambda s:
                    PlanningService(s, actor("admin")).department("202701", "PCMO", "MKT"))
                assert department["submitted"] == projects
                saved = await measure(connection, results, f"save_{dealers}_rows", lambda s:
                    WorkspaceService(s, actor("owner")).save_draft(budget_id,
                        InitiativeDraftUpdateDTO(expected_revision=1, rows=rows)))
                published = await measure(connection, results, "publish_saved_draft", lambda s:
                    WorkspaceService(s, actor("owner")).publish(budget_id,
                        PublishDTO(expected_revision=saved["revision"])))
                assert len(published["initiative"]["rows"]) == dealers
                await measure(connection, results, "create_version", lambda s:
                    PlanningService(s, actor("admin")).create(PlanningVersionCreateDTO(
                        id="202702", name="Synthetic copy", planning_year=2027,
                        source_version_id="202701")))
                async with session_for(connection) as session:
                    copied = list(await session.scalars(select(BudgetDO).where(
                        BudgetDO.planning_version_id == "202702")))
                    assert len(copied) == projects
                    assert sum(b.allocate_budget_amount for b in copied) == projects * dealers
                await measure(connection, results, "delete_version", lambda s:
                    PlanningService(s, actor("admin")).delete("202702",
                        PlanningVersionDeleteDTO(expected_revision=0)))
                assert transaction.is_active
            finally:
                await transaction.rollback()
                remaining = await connection.scalar(text(
                    "SELECT count(*) FROM pg_namespace WHERE nspname=:schema"), {"schema": schema})
                report["cleanup"] = "rolled_back_schema_absent" if remaining == 0 else "FAILED"
                await connection.rollback()
                assert remaining == 0
        report["status"] = "passed"
    except Exception as error:
        # Do not serialize exceptions: database errors can contain credentials or parameters.
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
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--projects", type=int, choices=range(1, 101), default=23)
    parser.add_argument("--dealers", type=int, choices=range(1, 1001), default=300)
    parser.add_argument("--label", default="current")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args.report, args.projects, args.dealers, args.label)))
