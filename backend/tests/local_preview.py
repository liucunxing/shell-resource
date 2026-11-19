"""Direct-entry HTML for the loopback-only synthetic browser fixture."""

import json
from pathlib import Path

from fastapi import FastAPI, Request
from sqlalchemy import Connection, inspect
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import HTMLResponse, Response

LOCAL_PREVIEW_USERS = [
    {"email": f"{name}@example.test", "label": label}
    for name, label in [
        ("owner-a", "Owner A · MKT"),
        ("owner-b", "Owner B · MKT"),
        ("owner-ice", "Owner · ICE"),
        ("lead", "部门负责人 · MKT"),
        ("lead-ice", "部门负责人 · ICE"),
        ("manager", "管理层"),
        ("admin", "管理员"),
    ]
]


def ensure_draft_reset_column(connection: Connection) -> None:
    """Upgrade persisted SQLite previews, where create_all skips existing tables."""
    columns = inspect(connection).get_columns("initiative_workflows", schema="data")
    if not any(column["name"] == "draft_reset_revision" for column in columns):
        connection.exec_driver_sql(
            "ALTER TABLE data.initiative_workflows ADD COLUMN draft_reset_revision INTEGER"
        )


def install_local_preview(
    app: FastAPI,
    frontend: Path,
    *,
    users: list[dict[str, str]] | None = None,
    default_email: str = "owner-a@example.test",
    data_label: str = "本地测试 · 合成数据",
) -> None:
    """Inject test identities only into this fixture's loopback entry document."""
    config = json.dumps(
        {
            "defaultEmail": default_email,
            "users": users or LOCAL_PREVIEW_USERS,
            "dataLabel": data_label,
        },
        ensure_ascii=True,
    )

    @app.middleware("http")
    async def preview_entry(request: Request, call_next: RequestResponseEndpoint) -> Response:
        index = frontend / "index.html"
        if (
            request.method == "GET"
            and request.url.path in {"/", "/index.html"}
            and request.url.hostname in {"localhost", "127.0.0.1", "::1"}
            and request.client is not None
            and request.client.host in {"127.0.0.1", "::1"}
            and index.is_file()
        ):
            html = index.read_text(encoding="utf-8")
            bootstrap = f"<script>window.__RESOURCE_LOCAL_PREVIEW__={config};</script>"
            return HTMLResponse(
                html.replace("<head>", "<head>" + bootstrap, 1),
                headers={"Cache-Control": "no-store"},
            )
        return await call_next(request)
