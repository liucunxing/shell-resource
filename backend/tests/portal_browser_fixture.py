"""Local Portal integration fixture: ephemeral SQLite and synthetic people only.

Start with the documented RESOURCE_PORTAL_* environment, PYTHONPATH=src, then:
  python -m uvicorn tests.portal_browser_fixture:app --host 127.0.0.1 --port 18184
No developer settings, production database, AI or Databricks connection is read.
"""

# ruff: noqa: E402
import os
from contextlib import asynccontextmanager
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
os.environ["APP_ENV"] = "test"
os.environ["APP_SETTINGS_FILE"] = str(ROOT / "config" / "settings.example.toml")

from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.session import get_db_session
from app.main import create_app
from app.models.do import BaseDO, BudgetDO
from app.models.do.distributor_history import distributor_sellin_resource_history
from app.models.do.workspace import UserPermissionDO, WorkspaceConfigDO
from app.repositories.distributor_directory_repository import DatabricksDistributorRepository

settings = get_settings()
if not settings.resource_portal_enabled or not settings.resource_portal_allow_loopback_http:
    raise RuntimeError("This synthetic fixture requires explicit local Portal configuration")
settings.serve_frontend = True
temporary = TemporaryDirectory(prefix="resource-portal-browser-")
database_dir = Path(temporary.name)
engine = create_async_engine("sqlite+aiosqlite:///" + (database_dir / "main.sqlite").as_posix())
factory = async_sessionmaker(engine, expire_on_commit=False)


@event.listens_for(engine.sync_engine, "connect")
def attach_database(connection, _):
    cursor = connection.cursor()
    cursor.execute("ATTACH DATABASE ? AS data", (str(database_dir / "data.sqlite"),))
    cursor.close()


async def local_session():
    async with factory() as session:
        yield session


async def synthetic_distributors(_self, sectors):
    return [{"distributor_code": "d1", "distributor_name": "Synthetic Dealer", "sector": "PCMO"}]


DatabricksDistributorRepository.list_distributors = synthetic_distributors


@asynccontextmanager
async def lifespan(_):
    async with engine.begin() as connection:
        await connection.run_sync(BaseDO.metadata.create_all)
    async with factory() as session:
        session.add(
            WorkspaceConfigDO(
                id=1,
                revision=0,
                budget_reasons=[{"id": "misc", "enabled": True}],
                budget_reason_version=1,
                guide={"version": 1, "text": "合成本地验收"},
                reference={},
            )
        )
        for number, name in enumerate(("alice", "bob"), start=1):
            session.add(
                UserPermissionDO(
                    id=number,
                    email=f"{name}@example.invalid",
                    role="owner",
                    department=["MKT"],
                    sector=["PCMO"],
                    display_name="Synthetic " + name.title(),
                    enabled=True,
                )
            )
            session.add(
                BudgetDO(
                    id=number,
                    planning_year=2027,
                    sector="PCMO",
                    department="MKT",
                    resource_type="MRD",
                    initiative_name=name.title() + " 本地验证项目",
                    plan_budget_amount=Decimal("100"),
                    allocate_budget_amount=Decimal(0),
                    status=0,
                    input_source="TEST_FIXTURE",
                    revision=0,
                    owner_email=f"{name}@example.invalid",
                )
            )
        await session.execute(
            distributor_sellin_resource_history.insert().values(
                distributor_code="d1",
                distributor_name="Synthetic Dealer",
                sector="PCMO",
                volume_2025=120,
                c3_2025=90,
                mrd_2025=20,
            )
        )
        await session.commit()
    try:
        yield
    finally:
        await engine.dispose()
        temporary.cleanup()


app = create_app()
app.router.lifespan_context = lifespan
app.dependency_overrides[get_db_session] = local_session
app.state.portal_embed.dependency_overrides[get_db_session] = local_session
