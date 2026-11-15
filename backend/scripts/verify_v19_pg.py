"""V19 PostgreSQL API acceptance in a disposable schema and rollback-only transaction.

Set APP_ENV=development and APP_SETTINGS_FILE to the approved local configuration.
Run explicitly with --report PATH. The script never reads/copies business rows,
executes migrations, or commits its outer transaction. Every service/API session
uses create_savepoint so application commits remain inside that transaction.
Reports contain synthetic identifiers and check status only, never error bodies,
connection strings, credentials, or business records.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from time import perf_counter
from typing import Any
from uuid import uuid4

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT / "src"))

import httpx  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import (  # noqa: E402
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    create_async_engine,
)

from app.core.config import get_settings  # noqa: E402
from app.core.resource_access import RESOURCE_TYPES  # noqa: E402
from app.models.do import BaseDO, BudgetDO  # noqa: E402
from app.models.do.distributor_history import distributor_sellin_resource_history  # noqa: E402
from app.models.do.workspace import UserPermissionDO, WorkspaceConfigDO  # noqa: E402

YEAR = 2027
FIRST = "202701"
SECOND = "202702"


class CheckFailure(RuntimeError):
    """Contains a synthetic check identifier only, never a database exception message."""


def require(condition: bool, check_id: str) -> None:
    if not condition:
        raise CheckFailure(check_id)


def record(checks: list[dict[str, str]], check_id: str, condition: bool = True) -> None:
    checks.append({"id": check_id, "status": "passed" if condition else "failed"})
    require(condition, check_id)


def session_for(connection: AsyncConnection) -> AsyncSession:
    return AsyncSession(
        connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )


async def seed_synthetic_data(connection: AsyncConnection) -> dict[str, str]:
    async with session_for(connection) as session:
        session.add(
            WorkspaceConfigDO(
                id=1,
                revision=0,
                budget_reasons=[{"id": "fixed", "label": "合成固定预留", "enabled": True}],
                department_resources={"PCMO|MKT": ["MRD"]},
                role_resources={
                    "owner": ["SP&A"],
                    "lead": [],
                    "management": list(RESOURCE_TYPES),
                    "admin": list(RESOURCE_TYPES),
                },
            )
        )
        people = [
            ("owner-a", "owner", ["MKT", "ICE"], ["PCMO"], "PCMO", "MKT", None),
            ("owner-b", "owner", ["MKT"], ["PCMO"], "PCMO", "MKT", ["Capex"]),
            ("owner-c", "owner", ["MKT"], ["CRTO"], "CRTO", "MKT", None),
            ("lead", "lead", ["MKT", "ICE"], ["PCMO"], "PCMO", "MKT", None),
            ("lead-crto", "lead", ["MKT"], ["CRTO"], "CRTO", "MKT", None),
            ("admin", "admin", [], [], "PCMO", "MKT", None),
            ("management", "management", [], [], "PCMO", "MKT", None),
            ("unaffiliated", "owner", ["MKT"], ["PCMO"], None, None, ["Capex"]),
        ]
        for name, role, departments, sectors, home_sector, home_department, expenses in people:
            session.add(
                UserPermissionDO(
                    email=f"{name}@example.test",
                    display_name=f"Synthetic {name}",
                    role=role,
                    department=departments,
                    sector=sectors,
                    enabled=True,
                    affiliation_sector=home_sector,
                    affiliation_department=home_department,
                    history_resources=expenses,
                )
            )
        budgets = []
        for key, sector, department, owner in [
            ("mkt-a1", "PCMO", "MKT", "owner-a"),
            ("mkt-a2", "PCMO", "MKT", "owner-a"),
            ("mkt-b", "PCMO", "MKT", "owner-b"),
            ("ice-a", "PCMO", "ICE", "owner-a"),
            ("crto-c", "CRTO", "MKT", "owner-c"),
        ]:
            budget = BudgetDO(
                planning_year=YEAR,
                sector=sector,
                department=department,
                resource_type="MRD",
                initiative_name=f"Synthetic {key}",
                plan_budget_amount=100,
                allocate_budget_amount=0,
                owner_email=f"{owner}@example.test",
                revision=0,
                status=0,
                input_source="PG_V19_TEST",
                enabled=True,
            )
            session.add(budget)
            budgets.append((key, budget))
        fixtures = []
        for code, sector in [("PG-V19-D1", "PCMO"), ("PG-V19-D2", "PCMO"), ("PG-V19-CRTO", "CRTO")]:
            fixtures.append(
                {
                    "distributor_code": code,
                    "distributor_name": f"Synthetic {code}",
                    "sector": sector,
                    "sd": "Synthetic SD",
                    "rsm": "Synthetic RSM",
                    "distributor_status": "1",
                    "volume_2024": 100,
                    "volume_2025": 120,
                    "volume_2026": 80,
                    "c3_2024": 20,
                    "c3_2025": 30,
                    "c3_2026": 15,
                    "mrd_2025": 10,
                    "reb_2025": 20,
                    "btl_2025": 30,
                    "capex_2025": 40,
                    "mrd_2026": 5,
                    "reb_2026": 10,
                    "btl_2026": 15,
                    "capex_2026": 20,
                    "yield_2025": 0.3,
                    "yield_2026": 0.3,
                }
            )
        await session.execute(distributor_sellin_resource_history.insert(), fixtures)
        await session.flush()
        keys = {key: str(budget.id) for key, budget in budgets}
        await session.commit()
    return keys


class AcceptanceAPI:
    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client

    async def call(
        self,
        method: str,
        path: str,
        actor: str = "admin",
        *,
        status: int = 200,
        body: dict[str, Any] | None = None,
    ) -> Any:
        response = await self.client.request(
            method, path, headers={"X-User-Email": f"{actor}@example.test"}, json=body
        )
        require(
            response.status_code == status,
            f"http_{method}_{path.split('?')[0]}_expected_{status}_actual_{response.status_code}",
        )
        # Response error detail may contain database content: never put it in a report.
        if status >= 400:
            return None
        envelope = response.json()
        require(isinstance(envelope, dict) and "data" in envelope, "api_response_envelope")
        return envelope["data"]

    async def workspace(self, actor: str, version: str = FIRST) -> dict[str, Any]:
        result = await self.call(
            "GET", f"workspace?planning_year={YEAR}&version_id={version}", actor
        )
        require(isinstance(result, dict), "workspace_response_shape")
        return dict(result)

    async def department(self, department: str = "MKT") -> dict[str, Any]:
        result = await self.call(
            "GET",
            f"planning-versions/{FIRST}/department?sector=PCMO&department={department}",
            "lead",
        )
        return dict(result)

    async def action(self, action: str, *, status: int = 200, **extra: Any) -> dict[str, Any]:
        current = await self.department()
        result = await self.call(
            "POST",
            f"planning-versions/{FIRST}/department/{action}",
            "lead",
            status=status,
            body={
                "sector": "PCMO",
                "department": "MKT",
                "expected_revision": current["version"]["revision"],
                **extra,
            },
        )
        return dict(result) if isinstance(result, dict) else {}

    async def submit(self, actor: str, item_id: str, dealer_id: str, *, reserve: int = 0) -> None:
        draft = await self.call("GET", f"initiatives/{item_id}/draft", actor)
        saved = await self.call(
            "PUT",
            f"initiatives/{item_id}/draft",
            actor,
            body={
                "expected_revision": draft["revision"],
                "rows": [
                    {
                        "dealerId": dealer_id,
                        "amount": 100 - reserve,
                        "note": "Synthetic dealer explanation",
                    }
                ],
                "otherBudgets": [{"reasonId": "fixed", "amount": reserve}] if reserve else [],
                "changeReason": "Synthetic review of the current version",
            },
        )
        await self.call(
            "POST",
            f"initiatives/{item_id}/publish",
            actor,
            body={"expected_revision": saved["revision"]},
        )


def by_key(workspace: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(item["initiativeKey"]): item for item in workspace["state"]["initiatives"]}


def visible_expenses(workspace: dict[str, Any]) -> set[str]:
    dealers = workspace["data"]["dealers"]
    require(bool(dealers), "synthetic_history_available")
    return set(dealers[0]["history"]["resources2025"])


async def check_api(connection: AsyncConnection, checks: list[dict[str, str]]) -> None:
    # Imported after safe configuration validation; no second engine is ever used for requests.
    from app.controllers.planning_controller import router as planning_router
    from app.controllers.workbench_controller import router as workbench_router
    from app.db.session import get_db_session

    source_keys = await seed_synthetic_data(connection)
    app = FastAPI()
    app.include_router(planning_router, prefix="/api/v1/workbench")
    app.include_router(workbench_router, prefix="/api/v1/workbench")

    async def database() -> AsyncIterator[AsyncSession]:
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
            "owner-a",
            status=403,
            body={"id": FIRST, "name": "Synthetic first", "planning_year": YEAR},
        )
        await api.call(
            "POST",
            "planning-versions",
            body={"id": FIRST, "name": "Synthetic first", "planning_year": YEAR},
        )
        await api.call("GET", f"workspace?planning_year={YEAR}", "owner-a", status=409)
        await api.call(
            "PATCH",
            f"planning-versions/{FIRST}",
            body={"expected_revision": 0, "published": True, "open": True},
        )
        record(checks, "version_create_admin_only_and_unpublished_gate")
        owner = await api.workspace("owner-a")
        lead = await api.workspace("lead")
        overview = await api.workspace("admin")
        items = by_key(overview)
        ids = {key: items[source]["id"] for key, source in source_keys.items()}
        dealer = next(row["id"] for row in owner["data"]["dealers"] if row["code"] == "PG-V19-D1")
        crto = await api.workspace("owner-c")
        crto_dealer = crto["data"]["dealers"][0]["id"]
        record(
            checks,
            "owner_multi_department_and_sector_scope",
            set(by_key(owner)) == {source_keys[k] for k in ("mkt-a1", "mkt-a2", "ice-a")},
        )
        record(
            checks,
            "lead_multi_department_and_sector_scope",
            set(by_key(lead)) == {source_keys[k] for k in ("mkt-a1", "mkt-a2", "mkt-b", "ice-a")},
        )
        await api.call("GET", f"initiatives/{ids['crto-c']}/draft", "owner-a", status=404)
        record(checks, "cross_sector_direct_draft_denied")
        await api.submit("owner-a", ids["mkt-a1"], dealer)
        await api.call(
            "PUT",
            f"initiatives/{ids['mkt-a1']}/draft",
            "owner-a",
            status=409,
            body={"expected_revision": 1, "rows": []},
        )
        await api.call(
            "POST",
            f"initiatives/{ids['mkt-a1']}/distributor-allocations",
            "owner-a",
            status=409,
            body={"distributor_code": "PG-V19-D2", "distributor_budget_amount": 0},
        )
        record(checks, "submitted_owner_frozen_in_draft_and_legacy_mutation_api")
        await api.action("confirm", status=409)
        record(checks, "all_enabled_initiatives_required_before_department_confirmation")
        await api.submit("owner-a", ids["mkt-a2"], dealer)
        await api.submit("owner-b", ids["mkt-b"], dealer, reserve=25)
        await api.submit("owner-a", ids["ice-a"], dealer)
        await api.submit("owner-c", ids["crto-c"], crto_dealer)
        hidden = await api.workspace("management")
        record(
            checks,
            "management_hides_all_unconfirmed_allocations",
            all(
                not item["allocationVisible"] and not item["rows"]
                for item in hidden["state"]["initiatives"]
            )
            and not hidden["state"]["publications"],
        )
        confirmed = await api.action("confirm")
        record(checks, "department_confirms_all_three_in_one_scope", confirmed["confirmed"] == 3)
        management = await api.workspace("management")
        visible_ids = {
            item["id"] for item in management["state"]["initiatives"] if item["allocationVisible"]
        }
        record(
            checks,
            "management_only_reads_confirmed_department_and_sector",
            visible_ids == {ids[k] for k in ("mkt-a1", "mkt-a2", "mkt-b")},
        )
        await api.action("return", status=409, reason="Synthetic return before withdrawal")
        await api.action("withdraw", status=422)
        withdrawn = await api.action("withdraw", reason="Synthetic withdrawal")
        record(
            checks,
            "withdraw_retains_owner_submissions_and_allows_direct_reconfirmation",
            withdrawn["submitted"] == 3 and withdrawn["confirmed"] == 0 and withdrawn["canConfirm"],
        )
        hidden = await api.workspace("management")
        history = await api.call("GET", f"initiatives/{ids['mkt-a1']}/publications", "management")
        record(
            checks,
            "withdraw_revokes_management_workspace_and_publication_history",
            not hidden["state"]["publications"]
            and history == []
            and all(not row["allocationVisible"] for row in hidden["state"]["initiatives"]),
        )
        await api.action("confirm")
        await api.action("withdraw", reason="Synthetic targeted correction")
        returned = await api.action(
            "return", reason="Synthetic single project", initiative_id=int(ids["mkt-a1"])
        )
        current = {row["id"]: row for row in returned["items"]}
        record(
            checks,
            "single_project_return_does_not_return_sibling_same_owner",
            current[ids["mkt-a1"]]["workflow"]["requiresResubmission"]
            and current[ids["mkt-a2"]]["workflow"]["submitted"]
            and current[ids["mkt-b"]]["workflow"]["submitted"]
            and not returned["canConfirm"],
        )
        await api.submit("owner-a", ids["mkt-a1"], dealer)
        returned = await api.action(
            "return", reason="Synthetic Owner correction", owner_email="owner-a@example.test"
        )
        current = {row["id"]: row for row in returned["items"]}
        other_department = await api.department("ICE")
        record(
            checks,
            "owner_return_is_limited_to_current_department",
            all(current[ids[k]]["workflow"]["requiresResubmission"] for k in ("mkt-a1", "mkt-a2"))
            and current[ids["mkt-b"]]["workflow"]["submitted"]
            and other_department["items"][0]["workflow"]["submitted"],
        )
        draft = await api.call("GET", f"initiatives/{ids['mkt-a1']}/draft", "owner-a")
        await api.call(
            "PUT",
            f"initiatives/{ids['mkt-a1']}/draft",
            "owner-a",
            body={
                "expected_revision": draft["revision"],
                "rows": [{"dealerId": dealer, "amount": 25}],
                "changeReason": "Synthetic unsubmitted edit not to be copied",
            },
        )
        await api.call(
            "POST",
            "planning-versions",
            body={
                "id": SECOND,
                "name": "Synthetic copied version",
                "planning_year": YEAR,
                "source_version_id": FIRST,
            },
        )
        copied = by_key(await api.workspace("admin", SECOND))
        record(
            checks,
            "copy_uses_last_submission_not_later_draft",
            copied[source_keys["mkt-a1"]]["rows"][0]["amount"] == 100,
        )
        copied_b = copied[source_keys["mkt-b"]]
        record(
            checks,
            "copy_preserves_reserve_and_dealer_explanation_but_no_workflow",
            copied_b["rows"][0]["amount"] == 75
            and copied_b["rows"][0]["note"] == "Synthetic dealer explanation"
            and copied_b["otherBudgets"][0]["amount"] == 25
            and all(
                not row["workflow"]["submitted"]
                and not row["workflow"]["confirmed"]
                and not row["changeReason"]
                for row in copied.values()
            ),
        )
        original = by_key(await api.workspace("admin", FIRST))
        record(
            checks,
            "versions_have_distinct_ids_and_independent_drafts",
            original[source_keys["mkt-a1"]]["rows"][0]["amount"] == 25
            and copied[source_keys["mkt-a1"]]["id"] != ids["mkt-a1"],
        )
        await api.call(
            "PATCH",
            f"planning-versions/{SECOND}",
            body={"expected_revision": 0, "published": True, "open": True},
        )
        await api.call(
            "PUT",
            f"initiatives/{ids['mkt-a1']}/draft",
            "owner-a",
            status=409,
            body={"expected_revision": draft["revision"] + 1, "rows": []},
        )
        await api.call(
            "PATCH",
            f"planning-versions/{SECOND}",
            status=409,
            body={"expected_revision": 0, "open": False},
        )
        record(checks, "opening_new_version_closes_source_and_rejects_stale_commands")
        await check_user_permissions(api, checks)
        current_version = (await api.workspace("admin", SECOND))["state"]["planningVersion"]
        await api.call(
            "PATCH",
            f"planning-versions/{SECOND}",
            body={
                "expected_revision": current_version["revision"],
                "open": False,
                "deadline": (datetime.now(UTC) - timedelta(minutes=1)).isoformat(),
            },
        )
        expired = await api.workspace("owner-a", SECOND)
        record(
            checks,
            "closed_expired_version_disables_owner_editing",
            expired["state"]["planningVersion"]["expired"]
            and all(not item["editable"] for item in expired["state"]["initiatives"]),
        )
        record(
            checks, "service_commits_remain_inside_outer_transaction", connection.in_transaction()
        )


async def check_user_permissions(api: AcceptanceAPI, checks: list[dict[str, str]]) -> None:
    record(
        checks,
        "expense_department_default",
        visible_expenses(await api.workspace("owner-a")) == {"MRD"},
    )
    record(
        checks,
        "expense_user_override_cannot_cross_home_department",
        visible_expenses(await api.workspace("owner-b")) == set(),
    )
    record(
        checks,
        "expense_home_department_default_without_role_fallback",
        visible_expenses(await api.workspace("owner-c")) == {"MRD", "SP&A"},
    )
    record(
        checks,
        "missing_affiliation_denies_even_explicit_expense_override",
        visible_expenses(await api.workspace("unaffiliated")) == set(),
    )
    users = await api.call("GET", "admin/users?department=ICE")
    emails = {row["email"] for row in users["items"]}
    record(
        checks,
        "postgres_array_department_membership",
        {"owner-a@example.test", "lead@example.test"}.issubset(emails)
        and "owner-b@example.test" not in emails,
    )
    body = {
        "email": "new-owner@example.test",
        "display_name": "Synthetic new Owner",
        "role": "owner",
        "department": ["MKT", "ICE"],
        "sector": ["PCMO"],
        "enabled": True,
    }
    await api.call("POST", "admin/users", status=422, body=body)
    body.update(
        affiliation_sector="CRTO", affiliation_department="MKT", history_resources=["Capex"]
    )
    created = await api.call("POST", "admin/users", body=body)
    record(
        checks,
        "user_affiliation_required_and_independent_from_business_array_scope",
        created["department"] == ["MKT", "ICE"]
        and created["sector"] == ["PCMO"]
        and created["affiliation_sector"] == "CRTO",
    )
    view = await api.workspace("new-owner", SECOND)
    record(
        checks,
        "affiliation_and_expense_override_do_not_expand_sector_scope",
        visible_expenses(view) == set()
        and {row["sector"] for row in view["data"]["dealers"]} == {"PCMO"},
    )
    await api.call("PUT", f"admin/users/{created['id']}", body={**body, "history_resources": []})
    record(
        checks,
        "explicit_empty_user_override_denies_all_expense_columns",
        visible_expenses(await api.workspace("new-owner", SECOND)) == set(),
    )
    await api.call("PUT", f"admin/users/{created['id']}", body={**body, "history_resources": None})
    record(
        checks,
        "null_override_inherits_home_department_ceiling",
        visible_expenses(await api.workspace("new-owner", SECOND)) == {"MRD", "SP&A"},
    )
    await api.call(
        "PUT",
        f"admin/users/{created['id']}",
        body={**body, "history_resources": None, "affiliation_sector": "PCMO"},
    )
    record(
        checks,
        "configured_department_default_takes_precedence_over_role",
        visible_expenses(await api.workspace("new-owner", SECOND)) == {"MRD"},
    )


async def run_acceptance(report_path: Path) -> int:
    schema = "codex_v19_" + uuid4().hex
    checks: list[dict[str, str]] = []
    report: dict[str, Any] = {
        "status": "running",
        "schema": schema,
        "checks": checks,
        "cleanup": "not_created",
        "business_writes": False,
        "synthetic_data": True,
    }
    engine: AsyncEngine | None = None
    started = perf_counter()
    try:
        require(bool(os.environ.get("APP_SETTINGS_FILE")), "explicit_settings_file_required")
        settings = get_settings()
        require(settings.app_env == "development", "development_profile_required")
        require(
            settings.database_url.get_secret_value().startswith("postgresql+asyncpg://"),
            "postgresql_asyncpg_connection_required",
        )
        engine = create_async_engine(
            settings.database_url.get_secret_value(),
            echo=False,
            hide_parameters=True,
            connect_args={
                "timeout": 15,
                "server_settings": {"statement_timeout": "20000", "lock_timeout": "3000"},
            },
        )
        async with engine.connect() as raw_connection:
            connection = await raw_connection.execution_options(
                schema_translate_map={"data": schema}
            )
            transaction = await connection.begin()
            try:
                await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
                report["cleanup"] = "pending_rollback"
                await connection.run_sync(BaseDO.metadata.create_all)
                kind = await connection.scalar(
                    text(
                        "SELECT udt_name FROM information_schema.columns "
                        "WHERE table_schema=:schema "
                        "AND table_name='user_permissions' AND column_name='department'"
                    ),
                    {"schema": schema},
                )
                record(checks, "isolated_postgres_array_schema_created", kind == "_varchar")
                await check_api(connection, checks)
                require(transaction.is_active, "outer_transaction_must_not_be_committed")
            finally:
                await transaction.rollback()
                report["cleanup"] = "rolled_back"
                remaining = await connection.scalar(
                    text("SELECT count(*) FROM pg_namespace WHERE nspname=:schema"),
                    {"schema": schema},
                )
                record(checks, "isolated_schema_absent_after_rollback", remaining == 0)
                await connection.rollback()
            report["status"] = "passed"
    except Exception as error:
        report["status"] = "failed"
        report["error_type"] = type(error).__name__
        if isinstance(error, CheckFailure):
            report["failed_check"] = str(error)
    finally:
        if engine is not None:
            try:
                await engine.dispose()
            except Exception:
                report["status"] = "failed"
                report["dispose_status"] = "failed"
        report["elapsed_seconds"] = round(perf_counter() - started, 3)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    arguments = parser.parse_args()
    raise SystemExit(asyncio.run(run_acceptance(arguments.report)))
