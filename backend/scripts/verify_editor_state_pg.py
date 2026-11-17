"""Rehearse the editor-state migration in a disposable PostgreSQL schema.

Reads only the real schema shape/revision. All DDL and synthetic rows target a
random schema in one rolled-back transaction; there is no apply option.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from app.core.config import get_settings  # noqa: E402


async def verify(expected_database: str, report_path: Path) -> None:
    settings = get_settings()
    if settings.app_env != "development":
        raise RuntimeError("Use the development profile")
    engine = create_async_engine(
        settings.database_url.get_secret_value(), hide_parameters=True,
        connect_args={"timeout": 15, "server_settings": {"statement_timeout": "30000"}},
    )
    schema = "codex_editor_state_" + uuid4().hex[:12]
    report: dict = {"status": "running", "applied_to_business_schema": False}
    try:
        async with engine.connect() as connection:
            if await connection.scalar(text("SELECT current_database()")) != expected_database:
                raise RuntimeError("Connected database does not match")
            before_revision = await connection.scalar(
                text("SELECT version_num FROM public.alembic_version"),
            )
            before_column = await connection.scalar(text(
                "SELECT count(*) FROM information_schema.columns WHERE table_schema='data' "
                "AND table_name='budgets' AND column_name='editor_state'",
            ))
            await connection.rollback()
            transaction = await connection.begin()
            try:
                await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
                await connection.execute(text(
                    f'CREATE TABLE "{schema}".budgets (LIKE data.budgets INCLUDING ALL)',
                ))
                await connection.execute(text(
                    f'INSERT INTO "{schema}".budgets '
                    "(id,planning_year,sector,department,resource_type,initiative_name,"
                    "plan_budget_amount,allocate_budget_amount,owner_email,revision,status,"
                    "input_source,enabled) OVERRIDING SYSTEM VALUE VALUES "
                    "(910001,2027,'PCMO','MKT','TEST','Synthetic draft',100,0,"
                    "'editor@example.test',7,0,'TEST',true)",
                ))
                spec = importlib.util.spec_from_file_location(
                    "editor_state_migration",
                    ROOT / "migrations/versions/20261117_01_initiative_editor_state.py",
                )
                if spec is None or spec.loader is None:
                    raise RuntimeError("Missing migration")
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                statements: list[str] = []

                class Operations:
                    def execute(self, statement: str) -> None:
                        if not (
                            statement == "SET LOCAL lock_timeout = '2s'"
                            or statement.startswith("ALTER TABLE data.budgets ADD COLUMN")
                        ):
                            raise RuntimeError("Unexpected migration statement")
                        statements.append(statement.replace("data.budgets", f'"{schema}".budgets'))

                with patch.object(module, "op", Operations()):
                    module.upgrade()
                for statement in statements:
                    await connection.execute(text(statement))
                original = (await connection.execute(text(
                    f'SELECT revision,plan_budget_amount,editor_state FROM "{schema}".budgets',
                ))).one()
                assert original.revision == 7 and original.plan_budget_amount == 100
                assert original.editor_state is None
                state = {"step": 3, "reserveAcknowledgement": '{"budget":100,"reserves":[]}'}
                await connection.execute(text(
                    f'UPDATE "{schema}".budgets SET editor_state=CAST(:state AS JSON) '
                    "WHERE id=910001",
                ), {"state": json.dumps(state)})
                loaded = await connection.scalar(text(
                    f'SELECT editor_state FROM "{schema}".budgets WHERE id=910001',
                ))
                assert loaded == state
                report.update(migration=module.revision, values_preserved=True, json_roundtrip=True)
            finally:
                await transaction.rollback()
            assert await connection.scalar(text(
                "SELECT count(*) FROM pg_namespace WHERE nspname=:schema",
            ), {"schema": schema}) == 0
            assert await connection.scalar(text(
                "SELECT version_num FROM public.alembic_version",
            )) == before_revision
            assert await connection.scalar(text(
                "SELECT count(*) FROM information_schema.columns WHERE table_schema='data' "
                "AND table_name='budgets' AND column_name='editor_state'",
            )) == before_column
            report.update(status="passed", cleanup="rolled_back", business_schema_unchanged=True)
    except Exception as exc:
        report.update(status="failed", error_type=type(exc).__name__)
        raise
    finally:
        await engine.dispose()
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-database", required=True)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    asyncio.run(verify(args.expected_database, args.report))
