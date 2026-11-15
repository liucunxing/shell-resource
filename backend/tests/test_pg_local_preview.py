import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from scripts.pg_local_preview import create_pg_local_preview, install_pg_preview


def fixture_app(tmp_path):
    (tmp_path / "index.html").write_text(
        '<html><head><script type="module" src="/assets/app.js"></script></head></html>',
        encoding="utf-8",
    )
    app = FastAPI()

    async def users():
        return [
            {"email": "admin@company.test", "role": "admin", "label": "</script><script>bad()"},
            {"email": "manager@company.test", "role": "management", "label": "Manager"},
        ]

    install_pg_preview(app, tmp_path, users)
    return app


def test_direct_pg_entry_uses_current_accounts_and_escapes_database_labels(tmp_path):
    client = TestClient(fixture_app(tmp_path), base_url="http://127.0.0.1:8020",
                        client=("127.0.0.1", 50000))
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    raw = response.text.split("__RESOURCE_LOCAL_PREVIEW__=", 1)[1].split(";</script>", 1)[0]
    config = json.loads(raw)
    assert config["dataMode"] == "pg-real"
    assert config["defaultEmail"] == "manager@company.test"
    assert "bad()" in config["users"][0]["label"]
    assert "</script>" not in raw
    assert response.text.index("__RESOURCE_LOCAL_PREVIEW__") < response.text.index('type="module"')
    # The wrapper adds no API identity override and does not replace Portal routes.
    assert client.get("/api/v1/workbench/workspace").status_code == 404
    assert client.get("/portal-embed/").status_code == 404


@pytest.mark.parametrize("host,client_ip", [
    ("http://example.com", "127.0.0.1"), ("http://localhost", "10.0.0.2"),
])
def test_non_loopback_never_receives_accounts_or_api_access(tmp_path, host, client_ip):
    client = TestClient(fixture_app(tmp_path), base_url=host, client=(client_ip, 50000))
    for path in ("/", "/api/v1/workbench/workspace"):
        response = client.get(path)
        assert response.status_code == 403
        assert "company.test" not in response.text


@pytest.mark.parametrize("environment", ["test", "production"])
def test_pg_preview_cannot_start_in_test_or_production_profile(monkeypatch, environment):
    monkeypatch.setattr("scripts.pg_local_preview.get_settings", lambda: SimpleNamespace(
        app_env=environment,
    ))
    with pytest.raises(RuntimeError, match="development"):
        create_pg_local_preview()
