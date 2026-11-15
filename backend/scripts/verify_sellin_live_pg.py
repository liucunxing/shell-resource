"""Full-source PG projection and workflow test; isolated schema, outer rollback only.

The existing real sell-in table is read/copied inside PG without exporting records.
Only synthetic users, budgets, and workflow records are written in a disposable
schema. Reports contain counts/checks, never business rows or connection secrets.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from collections import Counter
from decimal import Decimal
from pathlib import Path
from time import perf_counter
from typing import Any
from uuid import uuid4

import httpx
from fastapi import FastAPI
from sqlalchemy import Numeric, text
from sqlalchemy.ext.asyncio import create_async_engine
from verify_v19_pg import (
    FIRST,
    SECOND,
    YEAR,
    AcceptanceAPI,
    BaseDO,
    CheckFailure,
    by_key,
    get_settings,
    record,
    require,
    seed_synthetic_data,
    session_for,
)

from app.core.dealer_identity import dealer_identity
from app.core.distributor_status import distributor_status
from app.models.do.distributor_history import distributor_sellin_resource_history

SOURCE = "data.distributor_sellin_resource_history"
METRICS = {
    "vol2024": "volume_2024",
    "c32024": "c3_2024",
    "vol2025": "volume_2025",
    "c32025": "c3_2025",
    "vol2026Ytd": "volume_2026",
    "c32026Ytd": "c3_2026",
}
RESOURCE_COLUMNS = {"MRD": "mrd", "SP&A": "btl", "ICE Rebate": "reb", "Capex": "capex"}


def number(value: Any) -> float | None:
    return None if value is None else float(value)


def expected_projection(row: Any, visible: set[str]) -> tuple:
    values: list[Any] = [
        dealer_identity(row),
        str(row["distributor_code"]),
        row["sector"],
        row["sd"],
        row["rsm"],
        distributor_status(row["distributor_status"]),
    ]
    values.extend(number(row[column]) for column in METRICS.values())
    for year in (2025, 2026):
        amounts = [row[f"{prefix}_{year}"] for prefix in RESOURCE_COLUMNS.values()]
        values.extend(number(row[f"{prefix}_{year}"])
                      for resource, prefix in RESOURCE_COLUMNS.items() if resource in visible)
        values.append(number(sum(amounts)) if all(v is not None for v in amounts) else None)
    expenses_2025 = [row[f"{prefix}_2025"] for prefix in RESOURCE_COLUMNS.values()]
    investment = sum(expenses_2025) if all(value is not None for value in expenses_2025) else None
    c3 = row["c3_2025"]
    if c3 is None or investment is None:
        values.extend((None, "missing_inputs"))
    elif c3 <= 0 or investment <= 0:
        values.extend((None, "non_positive_inputs"))
    else:
        amounts = [Decimal(str(row[f"{prefix}_2025"])) for prefix in RESOURCE_COLUMNS.values()]
        values.extend((float(Decimal(str(c3)) / sum(amounts)), None))
    for metric in ("volume", "c3"):
        base, current = row[f"{metric}_2024"], row[f"{metric}_2025"]
        if base is None:
            values.extend((None, "missing_base"))
        elif base <= 0:
            values.extend((None, "no_base"))
        elif current is None:
            values.extend((None, "missing_current"))
        else:
            base_decimal = Decimal(str(base))
            growth = float((Decimal(str(current)) - base_decimal) / base_decimal * 100)
            values.extend((growth, None))
    return tuple(values)


def actual_projection(row: dict, visible: set[str]) -> tuple:
    history = row["history"]
    values = [row["id"], row["code"], row["sector"], row["sd"], row["rsm"], row["status"]]
    values.extend(history[key] for key in METRICS)
    for suffix in ("2025", "2026Ytd"):
        values.extend(history["resources" + suffix][key]
                      for key in RESOURCE_COLUMNS if key in visible)
        values.append(history["totalInvestment" + suffix])
    values.extend((history["yield"], history["yieldUnavailableReason"]))
    for key in ("yoyVol2425", "yoyC32425"):
        values.extend((history[key], history[key + "UnavailableReason"]))
    return tuple(values)


async def check_live_api(connection: Any, schema: str, report: dict) -> None:
    from app.controllers.planning_controller import router as planning_router
    from app.controllers.workbench_controller import router as workbench_router
    from app.db.session import get_db_session

    checks = report["checks"]
    keys = await seed_synthetic_data(connection)
    await connection.execute(
        text(
            f'UPDATE "{schema}".user_permissions '
            "SET history_resources=ARRAY['MRD','SP&A','ICE Rebate','Capex'] "
            "WHERE email='admin@example.test'"
        )
    )
    target = f'"{schema}".distributor_sellin_resource_history'
    await connection.execute(text(f"DELETE FROM {target}"))
    # Source numeric precision is owned by the data pipeline; do not round it
    # through the ORM's historical Numeric(10, 2) DDL in this disposable copy.
    numeric_changes = ", ".join(
        f'ALTER COLUMN "{column.name}" TYPE numeric'
        for column in distributor_sellin_resource_history.columns
        if isinstance(column.type, Numeric)
    )
    await connection.execute(text(f"ALTER TABLE {target} {numeric_changes}"))
    columns = [column.name for column in distributor_sellin_resource_history.columns]
    names = ", ".join(f'"{name}"' for name in columns)
    expressions = ", ".join(
        f'CAST("{name}" AS varchar(255))' if name == "distributor_status" else f'"{name}"'
        for name in columns
    )
    await connection.execute(
        text(f"INSERT INTO {target} ({names}) SELECT {expressions} FROM {SOURCE}")
    )
    source_rows = (await connection.execute(text(f"SELECT * FROM {SOURCE}"))).mappings().all()
    copied_count = await connection.scalar(text(f"SELECT count(*) FROM {target}"))
    report["source_rows"] = len(source_rows)
    report["source_sector_counts"] = dict(Counter(row["sector"] for row in source_rows))
    record(
        checks,
        "all_source_rows_copied_to_transaction_only_schema",
        len(source_rows) > 0 and copied_count == len(source_rows),
    )

    app = FastAPI()
    app.include_router(planning_router, prefix="/api/v1/workbench")
    app.include_router(workbench_router, prefix="/api/v1/workbench")

    async def database():
        async with session_for(connection) as session:
            yield session

    app.dependency_overrides[get_db_session] = database
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://synthetic.test/api/v1/workbench/"
    ) as client:
        api = AcceptanceAPI(client)
        await api.call(
            "POST",
            "planning-versions",
            body={"id": FIRST, "name": "Live history isolated acceptance", "planning_year": YEAR},
        )
        await api.call(
            "PATCH",
            f"planning-versions/{FIRST}",
            body={"expected_revision": 0, "published": True, "open": True},
        )
        admin = await api.workspace("admin")
        dealers = admin["data"]["dealers"]
        report["api_identity_counts"] = {
            "rows": len(dealers),
            "distinct_ids": len({row["id"] for row in dealers}),
            "duplicate_id_rows": len(dealers) - len({row["id"] for row in dealers}),
        }
        # No single persona can see all expense categories. Verify the complete
        # source through three synthetic home departments without widening access.
        for department, visible in (
            ("MKT", {"MRD"}),
            ("ICE", {"SP&A", "ICE Rebate"}),
            ("CAPEX", {"Capex"}),
        ):
            await connection.execute(
                text(f'UPDATE "{schema}".user_permissions '
                     "SET affiliation_department=:department "
                     "WHERE email='admin@example.test'"),
                {"department": department},
            )
            scoped_dealers = (await api.workspace("admin"))["data"]["dealers"]
            record(
                checks,
                f"api_{department}_all_source_rows_and_authorized_metrics_match",
                all(set(row["history"]["resources2025"]) == visible
                    and set(row["history"]["resources2026Ytd"]) == visible
                    for row in scoped_dealers)
                and Counter(actual_projection(row, visible) for row in scoped_dealers)
                == Counter(expected_projection(row, visible) for row in source_rows),
            )
        record(
            checks,
            "missing_ytd_month_not_replaced_by_supplied_yield",
            all(row["history"]["yield2026Ytd"] is None for row in dealers),
        )
        report["history_manifest"] = admin["state"]["reference"]
        manifest = admin["state"]["reference"]
        record(
            checks,
            "display_month_does_not_prove_ytd_coverage",
            manifest["configuredYtdCutoffMonth"] == admin["state"]["ytdCutoffMonth"]
            and manifest["configuredMonthIsCoverageEvidence"] is False
            and manifest["actual"]["latestMonth"] is None
            and manifest["investment"]["latestMonth"] is None
            and manifest["ytdYieldComparable"] is False,
        )
        items = by_key(admin)
        ids = {key: items[source]["id"] for key, source in keys.items()}
        for actor, sector, allowed in (
            ("owner-a", "PCMO", {"MRD"}),
            ("owner-b", "PCMO", set()),
            ("owner-c", "CRTO", {"MRD", "SP&A"}),
            ("unaffiliated", "PCMO", set()),
        ):
            scope = await api.workspace(actor)
            scoped = scope["data"]["dealers"]
            record(
                checks,
                actor + "_all_sector_rows_visible_with_expense_scope",
                len(scoped) == sum(row["sector"] == sector for row in source_rows)
                and all(
                    row["sector"] == sector and set(row["history"]["resources2025"]) == allowed
                    for row in scoped
                ),
            )
        owner = await api.workspace("owner-a")
        chosen = next(row["id"] for row in owner["data"]["dealers"] if row["status"] == "active")
        await api.submit("owner-a", ids["mkt-a1"], chosen)
        await api.call(
            "PUT",
            f"initiatives/{ids['mkt-a1']}/draft",
            "owner-a",
            status=409,
            body={"expected_revision": 1, "rows": []},
        )
        record(checks, "save_submit_with_real_active_dealer_then_owner_freeze")
        await api.action("confirm", status=409)
        record(checks, "partial_department_submission_cannot_confirm")
        await api.submit("owner-a", ids["mkt-a2"], chosen)
        await api.submit("owner-b", ids["mkt-b"], chosen, reserve=25)
        before = await api.workspace("management")
        record(
            checks,
            "management_hides_unconfirmed_real_dealer_allocations",
            all(not row["rows"] for row in before["state"]["initiatives"]),
        )
        confirmed = await api.action("confirm")
        management = await api.workspace("management")
        record(
            checks,
            "confirmed_real_dealer_allocations_visible_to_management",
            confirmed["confirmed"] == 3
            and {
                row["id"] for row in management["state"]["initiatives"] if row["allocationVisible"]
            }
            == {ids[key] for key in ("mkt-a1", "mkt-a2", "mkt-b")},
        )
        await api.action("withdraw", reason="Isolated test withdrawal")
        returned = await api.action(
            "return", reason="Isolated test return", initiative_id=int(ids["mkt-a1"])
        )
        record(
            checks,
            "targeted_return_reopens_only_requested_real_dealer_plan",
            next(row for row in returned["items"] if row["id"] == ids["mkt-a1"])["workflow"][
                "requiresResubmission"
            ],
        )
        draft = await api.call("GET", f"initiatives/{ids['mkt-a1']}/draft", "owner-a")
        await api.call(
            "PUT",
            f"initiatives/{ids['mkt-a1']}/draft",
            "owner-a",
            body={
                "expected_revision": draft["revision"],
                "rows": [{"dealerId": chosen, "amount": 25}],
                "changeReason": "Unsubmitted change must not be copied",
            },
        )
        await api.call(
            "POST",
            "planning-versions",
            body={
                "id": SECOND,
                "name": "Isolated inherited live history",
                "planning_year": YEAR,
                "source_version_id": FIRST,
            },
        )
        inherited = by_key(await api.workspace("admin", SECOND))
        record(
            checks,
            "inheritance_copies_submitted_real_dealer_amount_not_new_draft",
            inherited[keys["mkt-a1"]]["rows"][0]["amount"] == 100
            and inherited[keys["mkt-a1"]]["rows"][0]["dealerId"] == chosen,
        )
        record(
            checks, "all_api_commits_remain_inside_outer_transaction", connection.in_transaction()
        )


async def run(report_path: Path) -> int:
    schema = "codex_live_sellin_" + uuid4().hex
    report: dict[str, Any] = {
        "status": "running",
        "schema": schema,
        "checks": [],
        "business_writes": False,
        "synthetic_workflow": True,
        "real_history_source": SOURCE,
        "cleanup": "not_created",
    }
    engine = None
    started = perf_counter()
    try:
        require(bool(os.getenv("APP_SETTINGS_FILE")), "explicit_settings_file_required")
        settings = get_settings()
        require(settings.app_env == "development", "development_profile_required")
        engine = create_async_engine(
            settings.database_url.get_secret_value(),
            hide_parameters=True,
            isolation_level="REPEATABLE READ",
            connect_args={
                "timeout": 15,
                "server_settings": {"statement_timeout": "30000", "lock_timeout": "3000"},
            },
        )
        async with engine.connect() as raw:
            connection = await raw.execution_options(schema_translate_map={"data": schema})
            transaction = await connection.begin()
            try:
                require(
                    await connection.scalar(text("select current_database()")) == "resource_dev",
                    "approved_resource_dev_database_required",
                )
                await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
                report["cleanup"] = "pending_rollback"
                await connection.run_sync(BaseDO.metadata.create_all)
                await check_live_api(connection, schema, report)
                require(transaction.is_active, "outer_transaction_not_committed")
            finally:
                await transaction.rollback()
                report["cleanup"] = "rolled_back"
                remaining = await connection.scalar(
                    text("SELECT count(*) FROM pg_namespace WHERE nspname=:schema"),
                    {"schema": schema},
                )
                record(report["checks"], "isolated_schema_absent_after_rollback", remaining == 0)
                await connection.rollback()
            report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error_type"] = type(error).__name__
        if isinstance(error, CheckFailure):
            report["failed_check"] = str(error)
    finally:
        if engine is not None:
            await engine.dispose()
        report["elapsed_seconds"] = round(perf_counter() - started, 3)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    raise SystemExit(asyncio.run(run(parser.parse_args().report)))
