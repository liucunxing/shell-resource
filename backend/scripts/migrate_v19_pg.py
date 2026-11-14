"""Rehearse V19 migrations on an isolated copy, optionally apply atomically.

Reads APP_SETTINGS_FILE/development. Reports contain schema and fingerprints,
never credentials or business rows. --apply requires the exact database name.
Existing business values are checked before committing the schema upgrade.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from alembic.migration import MigrationContext  # noqa: E402
from alembic.operations import Operations  # noqa: E402
from alembic.script import ScriptDirectory  # noqa: E402
from sqlalchemy import Column, Connection, text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine  # noqa: E402

from app.core.config import get_settings  # noqa: E402

TABLES = (
    "budgets",
    "budgets_distributor",
    "distributor_sellin_resource_history",
    "user_permissions",
    "workspace_config",
)


def require(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def ident(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def config() -> Config:
    result = Config(str(ROOT / "alembic.ini"))
    result.set_main_option("script_location", str(ROOT / "migrations"))
    return result


async def revision(connection: AsyncConnection) -> str:
    versions = list(
        (await connection.scalars(text("SELECT version_num FROM public.alembic_version"))).all()
    )
    require(len(versions) == 1, "Expected a single Alembic revision")
    return str(versions[0])


async def snapshot(connection: AsyncConnection, schema: str) -> dict:
    result: dict = {"columns": {}, "constraints": {}, "indexes": {}}
    for table in TABLES:
        result["columns"][table] = [
            dict(row)
            for row in (
                await connection.execute(
                    text(
                        "SELECT column_name,data_type,udt_name,is_nullable,column_default "
                        "FROM information_schema.columns WHERE table_schema=:schema "
                        "AND table_name=:table ORDER BY ordinal_position"
                    ),
                    {"schema": schema, "table": table},
                )
            ).mappings()
        ]
        result["constraints"][table] = [
            dict(row)
            for row in (
                await connection.execute(
                    text(
                        "SELECT con.conname AS name,con.contype::text AS kind,"
                        "pg_get_constraintdef(con.oid) AS definition "
                        "FROM pg_constraint con JOIN pg_class t ON t.oid=con.conrelid "
                        "JOIN pg_namespace n ON n.oid=t.relnamespace "
                        "WHERE n.nspname=:schema AND t.relname=:table ORDER BY con.conname"
                    ),
                    {"schema": schema, "table": table},
                )
            ).mappings()
        ]
        result["indexes"][table] = [
            dict(row)
            for row in (
                await connection.execute(
                    text(
                        "SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=:schema "
                        "AND tablename=:table ORDER BY indexname"
                    ),
                    {"schema": schema, "table": table},
                )
            ).mappings()
        ]
    return result


async def fingerprints(connection: AsyncConnection, schema: str, columns: dict) -> dict:
    result = {}
    for table, fields in columns.items():
        projection = ",".join(ident(field["column_name"]) for field in fields)
        require(bool(projection), f"Missing table {table}")
        row = (
            (
                await connection.execute(
                    text(
                        "SELECT count(*) AS rows,"
                        "md5(COALESCE(string_agg(h,'' ORDER BY h),'')) AS fingerprint "
                        f"FROM (SELECT md5(to_jsonb(ROW({projection}))::text) AS h "
                        f"FROM {ident(schema)}.{ident(table)}) values_to_check"
                    )
                )
            )
            .mappings()
            .one()
        )
        result[table] = dict(row)
    return result


class IsolatedOperations:
    def __init__(self, operations: Operations, schema: str) -> None:
        self.operations, self.schema = operations, schema

    def execute(self, statement: str) -> None:
        require("data." in statement, "Unexpected unqualified migration SQL")
        self.operations.execute(statement.replace("data.", f"{ident(self.schema)}."))

    def add_column(self, table: str, column: Column[Any], *, schema: str) -> None:
        require(schema == "data", "Unexpected migration schema")
        self.operations.add_column(table, column, schema=self.schema)


async def rehearse(connection: AsyncConnection, before: dict, current: str, head: str) -> dict:
    schema = "codex_v19_migration_" + uuid4().hex[:12]
    transaction = await connection.begin()
    try:
        await connection.execute(text(f"CREATE SCHEMA {ident(schema)}"))
        for table in TABLES:
            await connection.execute(
                text(
                    f"CREATE TABLE {ident(schema)}.{ident(table)} "
                    f"(LIKE data.{ident(table)} INCLUDING ALL)"
                )
            )
            # LIKE generates names for UNIQUE/PK constraints. Restore the names so
            # DROP CONSTRAINT in the real migration is rehearsed faithfully.
            actual = (await snapshot(connection, schema))["constraints"][table]
            for original in before["constraints"][table]:
                if original["kind"] not in {"u", "p"}:
                    continue
                match = next(
                    (
                        row
                        for row in actual
                        if row["definition"] == original["definition"]
                        and row["kind"] == original["kind"]
                    ),
                    None,
                )
                if match is None:
                    raise AssertionError(f"Constraint clone differs for {table}")
                if match["name"] != original["name"]:
                    await connection.execute(
                        text(
                            f"ALTER TABLE {ident(schema)}.{ident(table)} RENAME CONSTRAINT "
                            f"{ident(match['name'])} TO {ident(original['name'])}"
                        )
                    )
            await connection.execute(
                text(
                    f"INSERT INTO {ident(schema)}.{ident(table)} OVERRIDING SYSTEM VALUE "
                    f"SELECT * FROM data.{ident(table)}"
                )
            )
        scripts = ScriptDirectory.from_config(config())
        pending = list(reversed(list(scripts.iterate_revisions(head, current))))

        def upgrade_copy(sync: Connection) -> None:
            operations = IsolatedOperations(Operations(MigrationContext.configure(sync)), schema)
            for script in pending:
                with patch.object(script.module, "op", operations):
                    script.module.upgrade()

        await connection.run_sync(upgrade_copy)
        copied = await fingerprints(connection, schema, before["columns"])
        require(copied == before["fingerprints"], "Rehearsal changed existing business values")
        defaults = await connection.scalar(
            text(f"SELECT health_thresholds FROM {ident(schema)}.workspace_config LIMIT 1")
        )
        require(isinstance(defaults, dict), "JSON default did not persist as an object")
        return {
            "revisions": [step.revision for step in pending],
            "values_preserved": True,
            "cleanup": "rolled_back",
        }
    finally:
        await transaction.rollback()
        remaining = await connection.scalar(
            text("SELECT count(*) FROM pg_namespace WHERE nspname=:schema"), {"schema": schema}
        )
        require(remaining == 0, "Rehearsal schema was not rolled back")
        await connection.rollback()


async def main(arguments: argparse.Namespace) -> None:
    settings = get_settings()
    require(settings.app_env == "development", "Use the development profile")
    engine = create_async_engine(
        settings.database_url.get_secret_value(),
        hide_parameters=True,
        connect_args={
            "timeout": 15,
            "server_settings": {"statement_timeout": "60000", "lock_timeout": "5000"},
        },
    )
    report: dict = {
        "time": datetime.now(UTC).isoformat(),
        "status": "running",
        "apply": arguments.apply,
    }
    try:
        async with engine.connect() as connection:
            database = await connection.scalar(text("SELECT current_database()"))
            require(database == arguments.expected_database, "Connected database does not match")
            current = await revision(connection)
            head = ScriptDirectory.from_config(config()).get_current_head()
            if head is None:
                raise AssertionError("Missing migration head")
            before = await snapshot(connection, "data")
            before["fingerprints"] = await fingerprints(connection, "data", before["columns"])
            before["revision"] = current
            arguments.snapshot.parent.mkdir(parents=True, exist_ok=True)
            arguments.snapshot.write_text(
                json.dumps(before, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            report.update(
                before_revision=current,
                target_revision=head,
                before_counts={t: row["rows"] for t, row in before["fingerprints"].items()},
            )
            await connection.rollback()
            if current != head:
                report["rehearsal"] = await rehearse(connection, before, current, head)
            if arguments.apply:
                async with connection.begin():
                    await connection.execute(
                        text(
                            "SELECT pg_advisory_xact_lock("
                            "hashtext('resource_studio_v19_migration'))"
                        )
                    )
                    require(
                        await revision(connection) == current,
                        "Migration revision changed concurrently",
                    )
                    # Briefly freeze writes to the five affected tables so the
                    # before/after value comparison detects migration effects only.
                    await connection.execute(
                        text(
                            "LOCK TABLE "
                            + ",".join(f"data.{ident(table)}" for table in TABLES)
                            + " IN SHARE ROW EXCLUSIVE MODE"
                        )
                    )
                    locked_before = await fingerprints(connection, "data", before["columns"])

                    def upgrade(sync: Connection) -> None:
                        cfg = config()
                        cfg.attributes["connection"] = sync
                        command.upgrade(cfg, "head")

                    await connection.run_sync(upgrade)
                    require(await revision(connection) == head, "Alembic head was not recorded")
                    after = await fingerprints(connection, "data", before["columns"])
                    require(after == locked_before, "Migration changed existing business values")
                    report.update(
                        after_revision=head,
                        values_preserved=True,
                        after_counts={t: row["rows"] for t, row in after.items()},
                    )
                report["transaction"] = "committed"
            report["status"] = "passed"
    except Exception as error:
        report.update(status="failed", error_type=type(error).__name__)
        if isinstance(error, AssertionError):
            report["error"] = str(error)
        raise
    finally:
        await engine.dispose()
        arguments.report.parent.mkdir(parents=True, exist_ok=True)
        arguments.report.write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database", required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    try:
        asyncio.run(main(parser.parse_args()))
    except Exception as error:
        print(
            f"Migration stopped: {type(error).__name__}; transaction rolled back.", file=sys.stderr
        )
        sys.exit(1)
