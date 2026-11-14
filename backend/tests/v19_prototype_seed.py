"""Import the exported prototype into an empty, explicitly SQLite-only fixture.

No settings, engine, network client or external credentials are loaded here.
Prototype budgets are CNY; historical money is USD and prototype volume is KL.
The application history contract stores L, so only volume is multiplied by 1000.
"""

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dealer_identity import dealer_identity
from app.dependencies.workbench_user import resolve_workbench_permission
from app.models.do.budget import BudgetDO
from app.models.do.budget_distributor import BudgetDistributorDO
from app.models.do.distributor_history import distributor_sellin_resource_history
from app.models.do.planning import InitiativeWorkflowDO, PlanningVersionDO
from app.models.do.workspace import (
    OtherBudgetDO,
    UserPermissionDO,
    WorkspaceConfigDO,
    WorkspacePublicationDO,
    default_budget_reasons,
)
from app.schemas.dto.planning import DepartmentActionDTO
from app.services.planning_service import PlanningService
from app.services.workspace_service import WorkspaceService

EXPORT = Path(__file__).parent / "fixtures" / "v19_prototype_demo.json"
ROLES = {"owner": "owner", "dept": "lead", "exec": "management", "admin": "admin"}
ROLE_LABELS = {"owner": "Owner", "dept": "部门负责人", "exec": "管理层", "admin": "管理员"}
RESOURCES = {"ice": "ICE Rebate", "mrd": "MRD", "spa": "SP&A", "capex": "Capex"}


def load_prototype(path: Path = EXPORT) -> dict:
    result = json.loads(path.read_text(encoding="utf-8"))
    metadata = result["metadata"]
    if metadata.get("kind") != "prototype-demo" or metadata.get("localOnly") is not True:
        raise ValueError("Only the explicitly local prototype export may be seeded")
    if metadata["units"] != {
        **metadata["units"],
        "planningAmountRaw": "CNY",
        "historicalAmountRaw": "USD",
        "volumeRaw": "KL",
    }:
        raise ValueError("Prototype units changed; review the import conversion first")
    return result


def synthetic_email(user: dict) -> str:
    identifier = str(user["id"]).lower()
    if not identifier.isascii() or not identifier.isalnum():
        raise ValueError("Prototype user id is not a safe synthetic identity")
    return f"v19-{identifier}@example.test"


def preview_users(prototype: dict) -> tuple[list[dict[str, str]], str]:
    users = [user for user in prototype["db"]["users"] if user["active"]]
    choices = [
        {"email": synthetic_email(user), "label": f"{user['name']} · {ROLE_LABELS[user['role']]}"}
        for user in users
    ]
    current = next(user for user in users if user["id"] == prototype["runtime"]["user"])
    return choices, synthetic_email(current)


def money(value: int | float | str) -> Decimal:
    amount = Decimal(str(value))
    if not amount.is_finite() or amount < 0 or amount != amount.to_integral_value():
        raise ValueError("Prototype planning amounts must be nonnegative integer CNY")
    return amount


def ratio(numerator: int | float | None, denominator: int | float | None) -> Decimal | None:
    if numerator is None or not denominator:
        return None
    return Decimal(str(numerator)) / Decimal(str(denominator))


def history_rows(prototype: dict, sectors: list[str]) -> list[dict]:
    """Expand the source's global pool only across sectors present in its projects."""
    records = prototype["historySnapshot"]["records"]
    rows = []
    for sector in sectors:
        for dealer in prototype["dealers"]:
            history = records[dealer["id"]]["history"]
            row = {
                "distributor_code": dealer["id"],
                "distributor_name": dealer["name"],
                "sector": sector,
                "sd": dealer["sd"],
                "rsm": dealer["rsm"],
                "distributor_status": dealer["status"],
            }
            for period, year in (("2024", 2024), ("2025", 2025), ("2026YTD", 2026)):
                values = history[period]
                row[f"volume_{year}"] = (
                    Decimal(str(values["vol"])) * 1000 if values["vol"] is not None else None
                )
                row[f"c3_{year}"] = values["c3"]
                if year != 2024:
                    for source, target in (
                        ("ice", "reb"),
                        ("mrd", "mrd"),
                        ("spa", "btl"),
                        ("capex", "capex"),
                    ):
                        row[f"{target}_{year}"] = values[source]
                    row[f"yield_{year}"] = ratio(values["c3"], values["investment"])
            for source, target in (("vol", "vol"), ("c3", "c3")):
                growth = ratio(history["2025"][source], history["2024"][source])
                row[f"yoy_{target}_24_25"] = growth - 1 if growth is not None else None
            rows.append(row)
    return rows


def _users(prototype: dict) -> list[UserPermissionDO]:
    access = {user["id"]: user["access"]["fields"] for user in prototype["userHistoryAccess"]}
    projects = [item for version in prototype["db"]["versions"] for item in version["catalog"]]
    result = []
    for user in prototype["db"]["users"]:
        scopes = list(user["scopes"])
        if user["role"] == "owner":
            # Prototype Owner visibility follows project ownership, including cross-department work.
            scopes += [
                {"sector": item["sector"], "dept": item["dept"]}
                for item in projects
                if item["owner"] == user["name"]
            ]
        home = user["homeScope"]
        result.append(
            UserPermissionDO(
                email=synthetic_email(user),
                display_name=user["name"],
                role=ROLES[user["role"]],
                department=sorted({scope["dept"].upper() for scope in scopes}),
                sector=sorted({scope["sector"] for scope in scopes}),
                enabled=user["active"],
                affiliation_sector=home["sector"],
                affiliation_department=home["dept"].upper(),
                history_resources=[RESOURCES[field] for field in access[user["id"]]],
            )
        )
    return result


def _allocation_rows(
    source: dict, budget: BudgetDO, identities: dict, reasons: dict[str, str]
) -> tuple[list[BudgetDistributorDO], list[OtherBudgetDO]]:
    selected = source.get("selected", [])
    if len(selected) != len(set(selected)):
        raise ValueError("Duplicate prototype dealer selection")
    if any(value and code not in selected for code, value in source.get("amounts", {}).items()):
        raise ValueError("Funded prototype dealer is absent from its selection")
    rows = []
    for code in selected:
        identity = identities[budget.sector, code]
        rows.append(
            BudgetDistributorDO(
                budget_id=budget.id,
                planning_year=budget.planning_year,
                sector=budget.sector,
                department=budget.department,
                resource_type=budget.resource_type,
                initiative_name=budget.initiative_name,
                distributor_code=code,
                history_key=dealer_identity(identity),
                sd=identity["sd"],
                rsm=identity["rsm"],
                distributor_budget_amount=money(source.get("amounts", {}).get(code, 0)),
                input_source="V19_LOCAL_DEMO",
                description=source.get("notes", {}).get(code, ""),
            )
        )
    other = [
        OtherBudgetDO(
            budget_id=budget.id,
            reason_id=reasons[reserve["reason"]],
            amount=money(reserve["amount"]),
            note=reserve.get("note", ""),
        )
        for reserve in source.get("reserves", [])
    ]
    total = sum((row.distributor_budget_amount for row in rows), Decimal(0))
    total += sum((row.amount for row in other), Decimal(0))
    if total > budget.plan_budget_amount:
        raise ValueError(f"Prototype allocations exceed budget {budget.initiative_key}")
    return rows, other


async def seed_prototype(
    session: AsyncSession, prototype: dict, *, prepare_confirmed_baseline: bool = True
) -> dict:
    """Seed once; reject all non-SQLite sessions before querying or writing anything."""
    if session.get_bind().dialect.name != "sqlite":
        raise ValueError("V19 prototype import is restricted to local SQLite")
    for model in (PlanningVersionDO, BudgetDO, UserPermissionDO, WorkspaceConfigDO):
        if await session.scalar(select(func.count()).select_from(model)):
            raise ValueError("Prototype import requires an empty fixture database")
    db = prototype["db"]
    now = datetime.now(UTC)
    sectors = sorted({item["sector"] for version in db["versions"] for item in version["catalog"]})
    history = history_rows(prototype, sectors)
    identities = {(row["sector"], row["distributor_code"]): row for row in history}
    await session.execute(distributor_sellin_resource_history.insert(), history)
    users = _users(prototype)
    session.add_all(users)
    user_by_name = {user.display_name: user.email for user in users}
    administrator = next(user.email for user in users if user.role == "admin")
    reasons = {
        item["name"]: f"v19-reason-{index + 1}"
        for index, item in enumerate(prototype["reserveReasons"])
    }
    session.add(
        WorkspaceConfigDO(
            id=1,
            budget_reasons=default_budget_reasons()
            + [
                {"id": reasons[item["name"]], "label": item["name"], "enabled": item["enabled"]}
                for item in prototype["reserveReasons"]
            ],
            reference={"localPrototypeSource": prototype["metadata"]},
            department_resources={},
            role_resources={
                ROLES[role]: [RESOURCES[field] for field in fields]
                for role, fields in db["historyAccess"]["roles"].items()
            },
            health_thresholds={
                "concentrationYellow": prototype["thresholds"]["gap"][0],
                "concentrationRed": prototype["thresholds"]["gap"][1],
                "dealerYellow": prototype["thresholds"]["dev"][0],
                "dealerRed": prototype["thresholds"]["dev"][1],
            },
        )
    )
    counts = []
    for index, version in enumerate(db["versions"]):
        version_id = version["id"]
        year = prototype["metadata"]["planningYearByVersion"][version_id]
        session.add(
            PlanningVersionDO(
                id=version_id,
                name=version["name"],
                planning_year=year,
                source_version_id=version["base"] or None,
                published=version["published"],
                open=version["open"],
                revision=0,
                created_by=administrator,
                created_at=now + timedelta(microseconds=index),
            )
        )
        budget_total = Decimal(0)
        count = {"versionId": version_id, "projects": 0, "submissions": 0, "confirmed": 0}
        for project in version["catalog"]:
            key = f"{version_id}|{project['id']}"
            draft, submission = db["drafts"].get(key, {}), db["submissions"].get(key)
            amount = money(project["budget"])
            budget = BudgetDO(
                planning_version_id=version_id,
                initiative_key=project["id"],
                enabled=project["enabled"],
                planning_year=year,
                sector=project["sector"],
                department=project["dept"].upper(),
                resource_type=project["type"],
                initiative_name=project["name"],
                plan_budget_amount=amount,
                allocate_budget_amount=0,
                owner_email=user_by_name[project["owner"]],
                revision=max(int(submission["revision"]) if submission else 0, int(bool(draft))),
                status=1 if submission else 0,
                input_source="V19_LOCAL_DEMO",
                created_at=now,
                updated_at=now,
            )
            session.add(budget)
            await session.flush()
            rows, other = _allocation_rows(draft, budget, identities, reasons)
            session.add_all([*rows, *other])
            budget.allocate_budget_amount = sum(
                (row.distributor_budget_amount for row in rows), Decimal(0)
            )
            await session.flush()
            await session.refresh(budget)
            state = InitiativeWorkflowDO(
                budget_id=budget.id,
                requires_resubmission=False,
                change_reason=draft.get("changeReason", project.get("reason", "")),
            )
            if submission:
                snapshot_rows, snapshot_other = _allocation_rows(
                    submission, budget, identities, reasons
                )
                snapshot = WorkspaceService._budget_projection(
                    budget, snapshot_rows, snapshot_other
                )
                snapshot["status"] = "completed"
                publication = WorkspacePublicationDO(
                    budget_id=budget.id,
                    department=budget.department,
                    publication_number=1,
                    published_revision=int(submission["revision"]),
                    snapshot={
                        "initiative": snapshot,
                        "reference": {
                            "source": "V19 prototype export",
                            "localOnly": True,
                            "sourceSha256": prototype["metadata"]["sourceSha256"],
                            "sourceSubmittedAt": submission.get("submittedAt"),
                            "sourceHistoryManifest": prototype["historySnapshot"]["manifest"],
                        },
                    },
                    note="V19 原型模拟提交；时间为本地导入时间",
                    created_at=now,
                )
                session.add(publication)
                await session.flush()
                state.publication_id = publication.id
                count["submissions"] += 1
            session.add(state)
            count["projects"] += 1
            budget_total += amount
        count["budgetCny"] = int(budget_total)
        counts.append(count)
    await session.commit()
    preparations = []
    if prepare_confirmed_baseline:
        planner = PlanningService(
            session, await resolve_workbench_permission(session, administrator)
        )
        baseline = db["versions"][0]
        for sector, department in sorted(
            {
                (item["sector"], item["dept"].upper())
                for item in baseline["catalog"]
                if item["enabled"]
            }
        ):
            version = await planner.version(baseline["id"])
            result = await planner.department(baseline["id"], sector, department)
            if result["canConfirm"]:
                result = await planner.department_action(
                    baseline["id"],
                    "confirm",
                    DepartmentActionDTO(
                        sector=sector, department=department, expected_revision=version.revision
                    ),
                )
                preparations.append(
                    {
                        "versionId": baseline["id"],
                        "sector": sector,
                        "department": department,
                        "action": "confirm",
                        "confirmedProjects": result["confirmed"],
                        "actor": administrator,
                        "reason": "Local management baseline demonstration",
                    }
                )
        counts[0]["confirmed"] = sum(item["confirmedProjects"] for item in preparations)
    return {
        "kind": "local-sqlite-prototype-import",
        "source": prototype["metadata"],
        "importedAt": now.isoformat(),
        "database": "SQLite only",
        "users": len(users),
        "sourceDealerCount": len(prototype["dealers"]),
        "historyIdentityCount": len(history),
        "sectors": sectors,
        "versions": counts,
        "derivedLocalPreparation": preparations,
        "derivedLocalConfiguration": {
            "addedSystemReasons": default_budget_reasons(),
            "reason": "Retain standard reserve/balance actions alongside all source reasons",
        },
        "sourceHistoryManifest": prototype["historySnapshot"]["manifest"],
        "mapping": {
            "volume": "Prototype KL multiplied by 1000 into application's L history columns",
            "money": "Historical USD unchanged; planning CNY unchanged",
            "identity": "Prototype users mapped by id to v19-<id>@example.test",
            "ownerScope": "Union of source project ownership; source home affiliation retained",
            "dealerScope": (
                "Global prototype pool repeated per project sector; no allocation repeated"
            ),
        },
        "limitations": [
            f"Historical rows have {len(history)} sector identities for "
            f"{len(prototype['dealers'])} global source dealers; cross-sector history totals "
            "are not the original global-pool totals.",
            "Source contract volume is retained only in the export; the application history "
            "model has no contract/PPP columns and both remain unavailable in its API.",
            "Prototype October coverage is retained in this manifest; current history API has no "
            "business-month columns and still reports an unknown cutoff and unavailable YTD Yield.",
            "History model rounds ratios to 2 decimal places; "
            "monetary and volume values are exact.",
            "The original export has zero confirmations; baseline confirmations above are local "
            "test preparation performed by the normal PlanningService after import.",
        ],
    }
