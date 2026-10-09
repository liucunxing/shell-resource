"""Isolated Insight acceptance app. Uses synthetic SQLite only; never PostgreSQL.

From backend: INSIGHT_LIVE=1 python -m uvicorn scripts.insight_local_fixture:app
AI is disabled unless INSIGHT_LIVE=1 is explicitly set before starting the process.
"""

# The test profile must be selected before any application imports.
# ruff: noqa: E402
import os
import tomllib
from contextlib import asynccontextmanager
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ["APP_ENV"] = "test"
os.environ["APP_SETTINGS_FILE"] = str(ROOT / "config/settings.example.toml")

from pydantic import SecretStr
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.session import get_db_session
from app.main import create_app
from app.models.do import BaseDO, BudgetDO
from app.models.do.budget_distributor import BudgetDistributorDO
from app.models.do.distributor_history import distributor_sellin_resource_history
from app.models.do.workspace import OtherBudgetDO, UserPermissionDO, WorkspaceConfigDO

CACHE = ROOT / ".cache/insight-integration"
CACHE.mkdir(parents=True, exist_ok=True)
engine = create_async_engine("sqlite+aiosqlite:///" + (CACHE / "main.sqlite").as_posix())
factory = async_sessionmaker(engine, expire_on_commit=False)


@event.listens_for(engine.sync_engine, "connect")
def attach_database(connection, _) -> None:
    cursor = connection.cursor()
    cursor.execute("ATTACH DATABASE ? AS data", (str(CACHE / "data.sqlite"),))
    cursor.close()


async def local_session():
    async with factory() as session:
        yield session


@asynccontextmanager
async def lifespan(_):
    async with engine.begin() as connection:
        await connection.run_sync(BaseDO.metadata.create_all)
    async with factory() as session:
        if await session.scalar(select(WorkspaceConfigDO.id)) is None:
            session.add(
                WorkspaceConfigDO(
                    id=1,
                    guide={
                        "version": 9,
                        "text": "合成验收数据。历史只供参考；暂无未来经营目标和投入阈值。",
                    },
                )
            )
            for email, role, department, sector in [
                ("insight-owner@example.test", "owner", "MKT", ["PCMO"]),
                ("insight-other@example.test", "owner", "MKT", ["PCMO"]),
                ("insight-lead@example.test", "lead", "MKT", ["PCMO"]),
                ("insight-manager@example.test", "management", None, None),
            ]:
                session.add(
                    UserPermissionDO(
                        email=email,
                        role=role,
                        department=department,
                        sector=sector,
                        display_name="Insight 本地验收",
                        enabled=True,
                    )
                )
            for index, owner, amount in [(1, "owner", 300000), (2, "other", 999999)]:
                session.add(
                    BudgetDO(
                        id=index,
                        planning_year=2027,
                        sector="PCMO",
                        department="MKT",
                        resource_type="MRD",
                        initiative_name=f"Insight 合成验收 {index}",
                        plan_budget_amount=Decimal(amount),
                        allocate_budget_amount=300000 if index == 1 else 0,
                        owner_email=f"insight-{owner}@example.test",
                        revision=1,
                        status=0,
                        input_source="SYNTHETIC_INSIGHT",
                    )
                )
            for index, (amount, historical_yield) in enumerate(
                [(90000, 6), (45000, 8), (35000, 12), (55000, 20), (30000, 10), (25000, 18)], 1
            ):
                code = f"SYN{index:03}"
                session.add(
                    BudgetDistributorDO(
                        budget_id=1,
                        planning_year=2027,
                        sector="PCMO",
                        department="MKT",
                        resource_type="MRD",
                        initiative_name="Insight 合成验收 1",
                        distributor_code=code,
                        distributor_budget_amount=Decimal(amount),
                        input_source="SYNTHETIC_INSIGHT",
                    )
                )
                await session.execute(
                    distributor_sellin_resource_history.insert().values(
                        distributor_code=code,
                        distributor_name=f"合成经销商 {index}",
                        sector="PCMO",
                        volume_2024=100 + index * 10,
                        volume_2025=95 + index * 12,
                        c3_2024=10000 + index * 1000,
                        c3_2025=9000 + index * 1400,
                        volume_2026=None,
                        c3_2026=None,
                        yield_2025=historical_yield,
                        mrd_2025=2000,
                        btl_2025=1000,
                        reb_2025=1000,
                        capex_2025=1000,
                    )
                )
            session.add(
                OtherBudgetDO(
                    budget_id=1,
                    reason_id="reserve",
                    amount=Decimal(20000),
                    note="合成场景的新经销商预留；已明确用途，尚未落实到具体经销商。",
                )
            )
            await session.commit()
    yield
    await engine.dispose()


settings = get_settings()
settings.serve_frontend = True
settings.frontend_dist_path = str(ROOT.parent / "frontend/dist")
settings.db_echo = False
settings.debug = False
settings.ai_api_key = SecretStr("")
settings.ai_base_url = ""
if (ROOT / "config/settings.toml").exists():
    development = tomllib.loads((ROOT / "config/settings.toml").read_text(encoding="utf-8"))[
        "development"
    ]
    settings.ai_model = development.get("ai_model") or "qwen3.8-flash"
    if os.environ.get("INSIGHT_LIVE") == "1":
        settings.ai_api_key = SecretStr(development.get("ai_api_key") or "")
        settings.ai_base_url = development.get("ai_base_url") or ""
        settings.ai_timeout_seconds = 120
app = create_app()
app.router.lifespan_context = lifespan
app.dependency_overrides[get_db_session] = local_session
