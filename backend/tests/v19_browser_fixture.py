"""Persistent local V19 acceptance app, synthetic data and SQLite only.

Run: python -m uvicorn tests.v19_browser_fixture:app --app-dir src --host 127.0.0.1 --port 8019
Open http://127.0.0.1:8019/ directly; test roles are selectable without login.
This module never reads developer credentials or contacts PostgreSQL/AI services.
"""

# ruff: noqa: E402
import os
from contextlib import asynccontextmanager
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ["APP_ENV"] = "test"
os.environ["APP_SETTINGS_FILE"] = str(ROOT / "config" / "settings.example.toml")

from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from tests.local_preview import install_local_preview

from app.core.config import get_settings
from app.db.session import get_db_session
from app.dependencies.workbench_user import WorkbenchUser
from app.main import create_app
from app.models.do import BaseDO, BudgetDO
from app.models.do.distributor_history import distributor_sellin_resource_history
from app.models.do.planning import PlanningVersionDO
from app.models.do.workspace import UserPermissionDO, WorkspaceConfigDO
from app.schemas.dto.planning import (
    DepartmentActionDTO,
    PlanningVersionCreateDTO,
    PlanningVersionUpdateDTO,
)
from app.schemas.dto.workbench import InitiativeDraftUpdateDTO, PublishDTO
from app.services.planning_service import PlanningService
from app.services.workspace_service import WorkspaceService

CACHE = ROOT / ".cache" / "v19-final"
CACHE.mkdir(parents=True, exist_ok=True)
engine = create_async_engine("sqlite+aiosqlite:///" + (CACHE / "main.sqlite").as_posix())
factory = async_sessionmaker(engine, expire_on_commit=False)


@event.listens_for(engine.sync_engine, "connect")
def attach_database(connection, _) -> None:
    connection.execute("ATTACH DATABASE ? AS data", (str(CACHE / "data.sqlite"),))


async def local_session():
    async with factory() as session:
        yield session


def identity(name: str, role: str, department: str = "MKT") -> WorkbenchUser:
    return WorkbenchUser(
        f"{name}@example.test",
        role,
        [department],
        name,
        ("PCMO",),
        affiliation_sector="PCMO",
        affiliation_department=department,
    )


async def seed(session) -> None:
    session.add(WorkspaceConfigDO(id=1))
    for name, role, department in [
        ("owner-a", "owner", "MKT"),
        ("owner-b", "owner", "MKT"),
        ("owner-ice", "owner", "ICE"),
        ("lead", "lead", "MKT"),
        ("lead-ice", "lead", "ICE"),
        ("manager", "management", "MKT"),
        ("admin", "admin", "MKT"),
    ]:
        session.add(
            UserPermissionDO(
                email=f"{name}@example.test",
                display_name=f"本地验收 {name}",
                role=role,
                department=[department] if role in {"owner", "lead"} else [],
                sector=["PCMO"] if role in {"owner", "lead"} else [],
                enabled=True,
                affiliation_sector="PCMO",
                affiliation_department=department,
            )
        )
    for n in range(1, 9):
        await session.execute(
            distributor_sellin_resource_history.insert().values(
                distributor_code=f"QA-{n:03}",
                distributor_name=f"合成经销商 {n}",
                sector="PCMO",
                sd="华东" if n <= 4 else "华南",
                rsm=f"RSM-{(n + 1) // 2}",
                distributor_status="1",
                volume_2024=8000 * n,
                c3_2024=3000 * n,
                volume_2025=10000 * n,
                c3_2025=4000 * n,
                volume_2026=7000 * n,
                c3_2026=3500 * n,
                mrd_2025=500 * n,
                reb_2025=300 * n,
                btl_2025=100 * n,
                capex_2025=100 * n,
                mrd_2026=400 * n,
                reb_2026=250 * n,
                btl_2026=100 * n,
                capex_2026=50 * n,
                yield_2025=4,
                yield_2026=4.375,
                yoy_vol_24_25=0.25,
                yoy_c3_24_25=0.3333,
            )
        )
    for n, owner, department, amount in [
        (1, "owner-a", "MKT", 100000),
        (2, "owner-a", "MKT", 60000),
        (3, "owner-b", "MKT", 80000),
        (4, "owner-ice", "ICE", 120000),
    ]:
        session.add(
            BudgetDO(
                id=n,
                planning_year=2027,
                sector="PCMO",
                department=department,
                resource_type="MRD" if department == "MKT" else "ICE Rebate",
                initiative_name=f"合成规划项目 {n}",
                plan_budget_amount=Decimal(amount),
                allocate_budget_amount=0,
                status=0,
                revision=0,
                input_source="LOCAL_QA",
                owner_email=f"{owner}@example.test",
            )
        )
    await session.commit()
    admin = PlanningService(session, identity("admin", "admin"))
    await admin.create(
        PlanningVersionCreateDTO(id="202701", name="本地验收 · 首版", planning_year=2027)
    )
    await admin.update(
        "202701", PlanningVersionUpdateDTO(expected_revision=0, published=True, open=True)
    )
    budgets = list(
        (
            await session.scalars(
                select(BudgetDO)
                .where(BudgetDO.planning_version_id == "202701")
                .order_by(BudgetDO.id)
            )
        ).all()
    )
    for budget in budgets:
        owner = WorkspaceService(
            session, identity(budget.owner_email.split("@")[0], "owner", budget.department)
        )
        workspace = await owner.get_workspace(2027)
        dealer_ids = [dealer["id"] for dealer in workspace["data"]["dealers"]]
        amount = budget.plan_budget_amount
        saved = await owner.save_draft(
            budget.id,
            InitiativeDraftUpdateDTO(
                expected_revision=0,
                rows=[
                    {
                        "dealerId": dealer_ids[0],
                        "amount": amount * Decimal("0.4"),
                        "note": "合成方案",
                    },
                    {
                        "dealerId": dealer_ids[4],
                        "amount": amount * Decimal("0.6"),
                        "note": "合成方案",
                    },
                    {"dealerId": dealer_ids[1], "amount": 0, "note": "入选但尚未获配"},
                ],
            ),
        )
        await owner.publish(budget.id, PublishDTO(expected_revision=saved["revision"]))
    for name, department in [("lead", "MKT"), ("lead-ice", "ICE")]:
        lead = PlanningService(session, identity(name, "lead", department))
        version = await lead.version("202701")
        await lead.department_action(
            "202701",
            "confirm",
            DepartmentActionDTO(
                sector="PCMO", department=department, expected_revision=version.revision
            ),
        )
    await admin.create(
        PlanningVersionCreateDTO(
            id="202702",
            name="本地验收 · 调整版",
            planning_year=2027,
            source_version_id="202701",
        )
    )
    await admin.update(
        "202702", PlanningVersionUpdateDTO(expected_revision=0, published=True, open=True)
    )


@asynccontextmanager
async def lifespan(_):
    async with engine.begin() as connection:
        await connection.run_sync(BaseDO.metadata.create_all)
    async with factory() as session:
        if await session.scalar(select(PlanningVersionDO.id).limit(1)) is None:
            await seed(session)
    yield
    await engine.dispose()


settings = get_settings()
settings.serve_frontend = True
settings.db_echo = False
app = create_app()
app.router.lifespan_context = lifespan
app.dependency_overrides[get_db_session] = local_session
install_local_preview(app, Path(settings.frontend_dist_path))
