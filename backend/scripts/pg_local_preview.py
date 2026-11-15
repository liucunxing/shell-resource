"""Explicit loopback-only PG testing entry; never seed data or replace API permissions.

Run with the approved development settings:
python -m uvicorn scripts.pg_local_preview:create_pg_local_preview --factory \
    --app-dir src --host 127.0.0.1 --port 8020
"""

import json
from collections.abc import Awaitable, Callable
from pathlib import Path

from fastapi import FastAPI, Request
from sqlalchemy import select
from sqlalchemy.engine import make_url
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import HTMLResponse, Response

from app.core.config import get_settings
from app.core.departments import departments
from app.models.do.workspace import UserPermissionDO

ROLE_LABELS = {"owner": "Owner", "lead": "部门负责人", "management": "管理层", "admin": "管理员"}
LOOPBACK = {"localhost", "127.0.0.1", "::1"}


async def enabled_pg_accounts() -> list[dict[str, str]]:
    from app.db.session import AsyncSessionFactory

    async with AsyncSessionFactory() as session:
        users = (await session.scalars(
            select(UserPermissionDO).where(
                UserPermissionDO.enabled.is_(True), UserPermissionDO.role.in_(ROLE_LABELS),
            ).order_by(UserPermissionDO.role, UserPermissionDO.email).limit(100)
        )).all()
        return [
            {"email": user.email.strip().lower(), "role": user.role,
             "label": f"{user.display_name[:55]} · {ROLE_LABELS[user.role]}"}
            for user in users
            if user.role not in {"owner", "lead"} or departments(user.department)
        ]


def install_pg_preview(
    app: FastAPI, frontend: Path,
    load_accounts: Callable[[], Awaitable[list[dict[str, str]]]] = enabled_pg_accounts,
) -> None:
    @app.middleware("http")
    async def local_entry(request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.hostname not in LOOPBACK or not request.client \
                or request.client.host not in {"127.0.0.1", "::1"}:
            return Response("Local PG testing is available only on loopback.", status_code=403)
        if request.method == "GET" and request.url.path in {"/", "/index.html"}:
            index = frontend / "index.html"
            if not index.is_file():
                return Response(
                    "Build the frontend before starting the PG preview.", status_code=503,
                )
            accounts = await load_accounts()
            if not accounts:
                return Response("No enabled PG test accounts are available.", status_code=503)
            default = next((u for u in accounts if u["role"] == "management"), accounts[0])
            config = json.dumps({
                "dataMode": "pg-real", "dataLabel": "main · 服务器 PG 真实数据",
                "defaultEmail": default["email"],
                "users": [{"email": u["email"], "label": u["label"]} for u in accounts],
            }, ensure_ascii=True)
            config = config.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
            bootstrap = f"<script>window.__RESOURCE_LOCAL_PREVIEW__={config};</script>"
            return HTMLResponse(
                index.read_text(encoding="utf-8").replace("<head>", "<head>" + bootstrap, 1),
                headers={"Cache-Control": "no-store"},
            )
        return await call_next(request)


def create_pg_local_preview() -> FastAPI:
    settings = get_settings()
    if settings.app_env != "development":
        raise RuntimeError("Local PG testing requires the development profile.")
    if make_url(settings.database_url.get_secret_value()).get_backend_name() != "postgresql":
        raise RuntimeError("Local PG testing requires an explicit PostgreSQL configuration.")
    from app.main import create_app

    app = create_app()
    install_pg_preview(app, Path(settings.frontend_dist_path))
    return app
