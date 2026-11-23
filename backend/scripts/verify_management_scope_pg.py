"""Exercise management ARRAY grants and migration in a rolled-back PG schema."""

import argparse
import asyncio
import importlib.util
import json
import sys
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
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
    schema = "codex_management_" + uuid4().hex[:12]
    report: dict = {"applied_to_business_schema": False}
    try:
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT current_database()")) == expected_database
            before = await conn.scalar(text("SELECT version_num FROM public.alembic_version"))
            await conn.rollback()
            tx = await conn.begin()
            try:
                await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
                await conn.execute(text(
                    f'CREATE TABLE "{schema}".user_permissions '
                    '(LIKE data.user_permissions INCLUDING ALL)',
                ))
                # Insert the old empty management grant before applying the migration.
                await conn.execute(text(
                    f'INSERT INTO "{schema}".user_permissions '
                    '(id,email,display_name,role,department,sector,enabled) '
                    "OVERRIDING SYSTEM VALUE VALUES (910001,'manager@example.test',"
                    "'Synthetic manager','management',ARRAY[]::varchar[],ARRAY[]::varchar[],true)",
                ))
                spec = importlib.util.spec_from_file_location(
                    "management_migration",
                    ROOT / "migrations/versions/20261123_01_management_sector_scope.py",
                )
                assert spec and spec.loader
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)

                async def migrate(direction: str) -> None:
                    statements = []

                    class Operations:
                        def execute(self, sql: str) -> None:
                            statements.append(sql.replace(
                                "data.user_permissions", f'"{schema}".user_permissions',
                            ))

                    with patch.object(module, "op", Operations()):
                        getattr(module, direction)()
                    for sql in statements:
                        await conn.execute(text(sql))

                async def grant(value: list[str | None]) -> None:
                    await conn.execute(text(
                        f'UPDATE "{schema}".user_permissions '
                        'SET sector=CAST(:sectors AS varchar[]) WHERE id=910001',
                    ), {"sectors": value})

                await migrate("upgrade")
                for sectors in [[], ["PCMO"], ["PCMO", "OEM"], ["PCMO", "CRTO", "B2B", "OEM"]]:
                    await grant(sectors)
                    assert await conn.scalar(text(
                        f'SELECT sector FROM "{schema}".user_permissions WHERE id=910001',
                    )) == sectors
                for invalid in [["OTHER"], ["PCMO", "PCMO"], [None], ["PCMO"] * 5]:
                    savepoint = await conn.begin_nested()
                    try:
                        await grant(invalid)
                    except DBAPIError:
                        pass
                    else:
                        raise AssertionError("Invalid ARRAY accepted")
                    finally:
                        await savepoint.rollback()
                savepoint = await conn.begin_nested()
                try:
                    await migrate("downgrade")
                except DBAPIError:
                    pass
                else:
                    raise AssertionError("Downgrade silently discarded grants")
                finally:
                    await savepoint.rollback()
                await grant([])
                await migrate("downgrade")
                await migrate("upgrade")
                report.update(array_roundtrip=True, invalid_grants_rejected=True,
                              legacy_empty_preserved=True, downgrade_guard=True)
            finally:
                await tx.rollback()
            assert await conn.scalar(text(
                "SELECT count(*) FROM pg_namespace WHERE nspname=:schema",
            ), {"schema": schema}) == 0
            assert await conn.scalar(text(
                "SELECT version_num FROM public.alembic_version",
            )) == before
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
