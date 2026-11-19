"""V20 local preview: isolated SQLite, preserved synthetic business data, V20 permissions.

Run from backend:
  python -m uvicorn tests.v20_prototype_fixture:app --app-dir src --host 127.0.0.1 --port 8021

This entry point never loads developer settings or the remote database configuration.
V19 fixture files and databases are not modified.
"""

# ruff: noqa: E402
import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ["APP_ENV"] = "test"
os.environ["APP_SETTINGS_FILE"] = str(ROOT / "config" / "settings.example.toml")

from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from tests.local_preview import ensure_draft_reset_column, install_local_preview
from tests.v19_prototype_seed import load_prototype, preview_users
from tests.v20_prototype_seed import seed_v20_prototype

from app.core.config import get_settings
from app.db.session import get_db_session
from app.main import create_app
from app.models.do import BaseDO
from app.models.do.planning import PlanningVersionDO

CACHE = ROOT / ".cache" / "v20-prototype"
CACHE.mkdir(parents=True, exist_ok=True)
engine = create_async_engine("sqlite+aiosqlite:///" + (CACHE / "main.sqlite").as_posix())
factory = async_sessionmaker(engine, expire_on_commit=False)
prototype = load_prototype()


@event.listens_for(engine.sync_engine, "connect")
def attach_database(connection, _) -> None:
    connection.execute("ATTACH DATABASE ? AS data", (str(CACHE / "data.sqlite"),))


async def local_session():
    async with factory() as session:
        yield session


@asynccontextmanager
async def lifespan(_):
    async with engine.begin() as connection:
        await connection.run_sync(BaseDO.metadata.create_all)
        await connection.run_sync(ensure_draft_reset_column)
    async with factory() as session:
        if await session.scalar(select(PlanningVersionDO.id).limit(1)) is None:
            manifest = await seed_v20_prototype(session, prototype)
            (CACHE / "import-manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
    yield
    await engine.dispose()


settings = get_settings()
settings.serve_frontend = True
settings.db_echo = False
app = create_app()
app.router.lifespan_context = lifespan
app.dependency_overrides[get_db_session] = local_session
users, default_email = preview_users(prototype)
install_local_preview(
    app, Path(settings.frontend_dist_path), users=users, default_email=default_email,
    data_label="V20 本地演示 · V19 合成业务快照 / V20 部门权限",
)
