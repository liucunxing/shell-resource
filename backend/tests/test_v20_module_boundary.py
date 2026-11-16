"""Retired drawer code is removed; retained history cannot be dropped by autogenerate."""

import runpy
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic import context
from fastapi.testclient import TestClient
from sqlalchemy import MetaData, Table
from starlette.routing import NoMatchFound

from app.main import create_app
from test_portal_receiver import receiver_settings

RETIRED_REQUESTS = [
    ("GET", "/insights"),
    ("GET", "/insights/preview"),
    ("POST", "/insights/preview"),
    ("PUT", "/insights/prompt"),
    ("POST", "/insights/generate"),
    ("POST", "/data-agent/launch"),
    ("POST", "/admin/reference"),
]


@pytest.mark.parametrize("prefix", ["", "/portal-embed"])
@pytest.mark.parametrize("method,path", RETIRED_REQUESTS)
def test_retired_module_endpoints_are_not_mounted(monkeypatch, prefix, method, path):
    # Enable the Portal receiver so 404 proves route removal, not a disabled app.
    monkeypatch.setattr("app.main.get_settings", receiver_settings)
    with TestClient(create_app()) as client:
        response = client.request(method, prefix + "/api/v1/workbench" + path)
    assert response.status_code == 404


def test_openapi_and_route_names_expose_only_active_modules(monkeypatch):
    monkeypatch.setattr("app.main.get_settings", receiver_settings)
    app = create_app()
    for current in (app, app.state.portal_embed):
        paths = current.openapi()["paths"]
        assert not any(
            retired in path for path in paths
            for retired in ("/insights", "/data-agent", "/admin/reference")
        )
        assert "/api/v1/workbench/workspace" in paths
        assert "/api/v1/workbench/distributors" in paths
        assert "/api/v1/workbench/planning-versions" in paths
        for name in (
            "get_insight", "generate_insight", "launch_data_agent", "post_admin_reference",
        ):
            with pytest.raises(NoMatchFound):
                current.url_path_for(name)
    assert "/login" in app.state.portal_embed.openapi()["paths"]
    assert "Insight" not in app.description


def test_autogenerate_preserves_only_retired_insight_history(monkeypatch):
    configured = []
    config = SimpleNamespace(
        config_file_name=None, attributes={},
        set_main_option=lambda *_: None, get_main_option=lambda _: "sqlite://",
    )
    monkeypatch.setattr(context, "config", config, raising=False)
    monkeypatch.setattr(context, "is_offline_mode", lambda: True)
    monkeypatch.setattr(context, "configure", lambda **kwargs: configured.append(kwargs))
    monkeypatch.setattr(context, "begin_transaction", nullcontext)
    monkeypatch.setattr(context, "run_migrations", lambda: None)
    namespace = runpy.run_path(str(Path(__file__).parents[1] / "migrations" / "env.py"))
    guard = configured[0]["include_object"]
    namespace["do_run_migrations"](object())
    assert configured[1]["include_object"] is guard
    for name in ("insight_records", "insight_prompts"):
        archived = Table(name, MetaData(), schema="data")
        assert not guard(archived, name, "table", True, None)
        assert guard(archived, name, "table", False, None)
        assert guard(archived, name, "table", True, archived)
        assert guard(archived, name, "column", True, None)
        other_schema = Table(name, MetaData(), schema="other")
        assert guard(other_schema, name, "table", True, None)
    active = Table("budgets", MetaData(), schema="data")
    assert guard(active, "budgets", "table", True, None)
