"""Local acceptance server; synthetic SQLite data, never connects to PostgreSQL.

Run from backend: .venv/Scripts/python -m uvicorn tests.browser_fixture:app --port 8014
The SQLite files live under .cache and survive restarts for persistence verification.
"""

# The test-only profile must be selected before app modules are imported.
# ruff: noqa: E402
import os
import tomllib
from contextlib import asynccontextmanager
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ["APP_ENV"] = "test"
os.environ["APP_SETTINGS_FILE"] = str(ROOT / "config" / "settings.example.toml")

from pydantic import SecretStr
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.session import get_db_session
from app.main import create_app
from app.models.do import BaseDO, BudgetDO
from app.models.do.workspace import UserPermissionDO, WorkspaceConfigDO, WorkspaceReferenceDO

CACHE = ROOT / ".cache"
CACHE.mkdir(exist_ok=True)
engine = create_async_engine("sqlite+aiosqlite:///" + (CACHE / "qa-main.sqlite").as_posix())
factory = async_sessionmaker(engine, expire_on_commit=False)


@event.listens_for(engine.sync_engine, "connect")
def attach_database(connection, _) -> None:
    cursor = connection.cursor()
    cursor.execute("ATTACH DATABASE ? AS data", (str(CACHE / "qa-data.sqlite"),))
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
            session.add(WorkspaceConfigDO(id=1))
            for email, role, department in [
                ("owner-a@example.test", "owner", "MKT"),
                ("owner-b@example.test", "owner", "MKT"),
                ("lead@example.test", "lead", "MKT"),
                ("manager@example.test", "management", None),
                ("admin@example.test", "admin", None),
            ]:
                session.add(
                    UserPermissionDO(
                        email=email,
                        role=role,
                        department=department,
                        sector=None,
                        display_name="本地验收 " + email.split("@")[0],
                        enabled=True,
                    )
                )
            for number, owner, amount in [(1, "a", 100), (2, "b", 200)]:
                session.add(
                    BudgetDO(
                        id=number,
                        planning_year=2027,
                        sector="P",
                        department="MKT",
                        resource_type="MRD",
                        initiative_name="本地验收项目 " + str(number),
                        plan_budget_amount=Decimal(amount),
                        allocate_budget_amount=Decimal(0),
                        status=0,
                        input_source="TEST_FIXTURE",
                        revision=0,
                        owner_email=f"owner-{owner}@example.test",
                    )
                )
            session.add(
                WorkspaceReferenceDO(
                    planning_year=2027,
                    dealer_id="D001",
                    dealer_name="本地验收经销商",
                    batch_id="LOCAL-QA",
                    as_of="2026-08-31",
                    vol2024=100,
                    c32024=80,
                    vol2025=120,
                    c32025=90,
                    vol2026_ytd=None,
                    c32026_ytd=None,
                    mrd2025=20,
                    spa2025=10,
                    ice2025=5,
                    capex2025=5,
                )
            )
            await session.commit()
    yield
    await engine.dispose()


settings = get_settings()
settings.serve_frontend = True
# A user-supplied development AI configuration can be tested with local data.
# No credentials are returned to the page; an empty key keeps generation disabled.
local_config = ROOT / "config" / "settings.toml"
if local_config.is_file():
    development = tomllib.loads(local_config.read_text(encoding="utf-8")).get("development", {})
    settings.ai_api_key = SecretStr(development.get("ai_api_key") or "")
    settings.ai_base_url = development.get("ai_base_url") or ""
    settings.ai_model = development.get("ai_model") or "qwen-plus"
    settings.ai_timeout_seconds = float(development.get("ai_timeout_seconds", 60))
app = create_app()
app.router.lifespan_context = lifespan
app.dependency_overrides[get_db_session] = local_session
